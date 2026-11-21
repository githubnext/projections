// Lays out a staged graph transition's stages up front and returns the transition, a pure function of progress.
import type {GraphLayout} from '../layout.js'
import type {ComparisonModel} from '../model.js'
import type {ScheduledStep} from '../timeline.js'
import {unscheduledWindow} from '../stages.js'
import type {StepWindows} from '../stages.js'
import type {GraphTransition, GraphTransitionOptions} from '../graph-transition.js'
import {moveCollides} from './collisions.js'
import {crossingMorphs} from './crossing.js'
import {diffFrame} from './diff-frame.js'
import {transitionFrame} from './frame.js'
import {stageLayout} from './layouts.js'
import {layerBands} from './bands.js'
import {transitionTiming} from './timing.js'
import type {Ends} from './timing.js'

/**
 * Lays out a comparison's staged graph transition (see `GraphTransition`): the union of both revisions and each
 * revision's own layout, with ELK, up front. The result is a pure function of progress, cheap enough to call every
 * frame. An extraction has one layout, so every frame is the same. `schedule` is the comparison's scheduled steps
 * (`RendererProps.schedule`); rows no step places arrive and leave in the unscheduled window.
 *
 * @throws `Error` when ELK cannot lay out the graph with finite geometry.
 * @example
 * ```ts
 * const transition = await createGraphTransition(props.model, props.schedule, {compound: true})
 * const frame = transition(props.progress)
 * ```
 */
export async function createGraphTransition(
  model: ComparisonModel,
  schedule: readonly ScheduledStep[],
  options: GraphTransitionOptions = {},
): Promise<GraphTransition> {
  const orientation = options.orientation ?? 'vertical'
  const axis = orientation === 'horizontal' ? {x: 1, y: 0} : {x: 0, y: 1}
  const include = options.include
  const entities = model.entities.filter(row => !include || include.has(row.id))
  const rows = new Map(entities.map(row => [row.id, row]))
  const timing = transitionTiming(model, schedule, rows)
  const {windows, edgeAliases} = timing
  let layout = stageLayout(model, entities, timing, options)

  const active = new Set(entities.filter(row => row.before).map(row => row.id))
  const finalActive = new Set(entities.filter(row => row.after).map(row => row.id))
  const every = new Set(entities.map(row => row.id))
  /*
   * Three layouts. The union holds every entity and every relationship of
   * either revision; Before and After are each revision's own layout, keeping
   * the union's layers and in-layer order (see `GraphLayoutOptions.hints`), so
   * moving between any two of them never passes one card through another.
   * The first step's move makes room for everything the comparison brings,
   * the steps between hold the union while entities fade in and out where
   * they belong, and the last step's move closes the gaps. Every frame draws
   * routes ELK made for the layout it shows.
   */
  let union = model.mode === 'comparison' ? await layout(every, undefined, undefined, true) : undefined
  // Cards in a layer of the union (an extraction's own layout) share its depth in every layout (see `layerBands`).
  const bands = layerBands(union ?? (await layout(active, 0)), orientation)
  if (bands.size) {
    layout = stageLayout(model, entities, timing, options, bands)
    if (union) union = await layout(every, undefined, undefined, true)
  }
  if (options.diffOnly && union) {
    const diff = diffFrame(union, entities, edgeAliases)
    return Object.assign(() => diff, {layouts: [union], diff})
  }
  // A held pane shows one revision: its own layout (placed as the union orders it, so both panes agree) is all it draws.
  if (options.held && union) {
    const side = await layout(
      options.held === 'before' ? active : finalActive,
      options.held === 'before' ? 0 : 1,
      union.points,
      false,
      union,
    )
    const frame = transitionFrame({entities, timing, stages: [side, union], events: [], axis})
    return Object.assign(frame, {layouts: [side], diff: diffFrame(union, entities, edgeAliases)})
  }
  // Every layout keeps the union's layer gap, so a gap grown for parallel runs never makes the cards jump between steps,
  // and its alignment, so the steps place cards alike.
  const pending: Promise<GraphLayout>[] = [layout(active, 0, union?.points, false, union)]
  const settled = layout(finalActive, 1, union?.points, false, union)
  const moves: {easing: StepWindows['easing']; time: number; radius: number}[] = windows.map(entry => ({
    easing: entry.easing,
    time: entry.move.time,
    radius: entry.move.radius,
  }))
  for (let index = 1; index < windows.length; index++) pending.push(Promise.resolve(union!))
  const changes = [...finalActive].some(id => !active.has(id)) || [...active].some(id => !finalActive.has(id))
  if (windows.length || changes) pending.push(settled)
  // Rows a comparison places in no step still arrive and leave, in the unscheduled window.
  if (!windows.length && changes) moves.push({easing: 'restructure', ...unscheduledWindow})
  const stages = await Promise.all(pending)
  if (union) keepApart(stages, union)
  const ends = new Map<string, Ends>()
  for (const {change, old, next, same} of edgeAliases) {
    if (same && next) ends.set(change.id, next)
    else {
      if (old) ends.set(`${change.id}:before`, old)
      if (next) ends.set(`${change.id}:after`, next)
    }
  }
  const events = moves.map((move, index) => ({
    ...move,
    before: stages[index]!,
    after: stages[index + 1]!,
    redraw: crossingMorphs(stages[index]!, stages[index + 1]!, ends, axis),
  }))

  const frame = transitionFrame({entities, timing, stages, events, axis})
  const diff = union ? diffFrame(union, entities, edgeAliases) : frame(1)
  return Object.assign(frame, {layouts: stages.filter((stage, index) => stages.indexOf(stage) === index), diff})
}

/**
 * ELK lays out each revision in the union's order where it can, but not always (a boundary's place among others, a
 * card whose relationships all leave): a move between two layouts that would pass one card or boundary through
 * another keeps the union's places for its Before or After instead, so the cards there fade in or out where they
 * are and nothing moves through anything else. An end whose boundaries the union doesn't share (a component moving
 * between modules leaves the union none) keeps its own layout, so Before and After always draw their revision.
 */
function keepApart(stages: GraphLayout[], union: GraphLayout): void {
  const replaceable = (layout: GraphLayout) =>
    layout !== union && [...layout.points.keys()].every(id => layout.groups.has(id) === union.groups.has(id))
  for (let index = 0; index + 1 < stages.length; index++) {
    if (!moveCollides(stages[index]!, stages[index + 1]!)) continue
    if (index === 0 && replaceable(stages[0]!)) {
      stages[0] = union
      if (!moveCollides(union, stages[1]!)) continue
    }
    if (replaceable(stages[index + 1]!)) stages[index + 1] = union
  }
}
