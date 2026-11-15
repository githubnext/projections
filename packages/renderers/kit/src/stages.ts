import type {Entity, Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {ComparisonModel} from './model.js'
import type {ScheduledStep} from './timeline.js'
import {motionWindow, stepProgress} from './timeline.js'
import {fadeIn, fadeOut, smootherstep, unitProgress} from './motion.js'

/** A span of progress, centred on `time` and reaching `radius` either side: `[time - radius, time + radius]`. */
export interface Window {
  /** The window's centre, as progress from 0 (Before) to 1 (After). */
  time: number
  /** Half the window's length, in progress; 0 for an instant. */
  radius: number
}

/** How one scheduled step uses its window. */
export interface StepWindows {
  /** The scheduled step these windows divide. */
  step: ScheduledStep
  /** Where leaving entities fade out. */
  fadeOut: Window
  /** Where arriving entities fade in. */
  fadeIn: Window
  /** Where the layout moves. */
  move: Window
  /**
   * What the step does: `remove` fades out then closes gaps, `add` makes room then fades in, `restructure` moves and
   * crossfades around its centre (as does a step that both removes and adds).
   */
  easing: 'remove' | 'add' | 'restructure'
  /** Crossfade for relationships rewired between surviving entities. */
  rewire: Window
}

const FADE_RADIUS = 0.055
/** Window for rows a comparison does not place in any step. */
export const unscheduledWindow: Window = {time: 0.5, radius: 0.16}

/**
 * Sub-windows of one step's motion (`motionWindow`, after any reading lead in
 * which removals stay fully present while their emphasis is read). Removals
 * fade out over the first 35% of the motion, then the layout closes their gap
 * over the remaining 65%; additions are given room over the first 65%, then
 * fade in over the rest; a restructure moves for its whole window, crossfading
 * rewired relationships around its centre. A step that both removes and adds
 * entities (only custom comparators produce one) fades out for 20%, moves for
 * 60% and fades in for 20%. Motion spans most of each step, and nothing fades
 * while the cards around it move.
 */
export function stepWindows(step: ScheduledStep, rows: ReadonlyMap<string, EntityChange<Entity>>): StepWindows {
  const {time, radius} = motionWindow(step)
  const removes = step.entities.some(id => !rows.get(id)?.after)
  const adds = step.entities.some(id => !rows.get(id)?.before)
  if (step.kind === 'remove' || (removes && !adds)) {
    const fade = {time: time - radius * 0.65, radius: radius * 0.35}
    return {step, fadeOut: fade, fadeIn: fade, move: {time: time + radius * 0.35, radius: radius * 0.65}, easing: 'remove', rewire: fade}
  }
  if (step.kind === 'add' || (adds && !removes)) {
    const fade = {time: time + radius * 0.65, radius: radius * 0.35}
    return {step, fadeOut: fade, fadeIn: fade, move: {time: time - radius * 0.35, radius: radius * 0.65}, easing: 'add', rewire: fade}
  }
  if (removes && adds) {
    return {
      step,
      fadeOut: {time: time - radius * 0.8, radius: radius * 0.2},
      fadeIn: {time: time + radius * 0.8, radius: radius * 0.2},
      move: {time, radius: radius * 0.6},
      easing: 'restructure',
      rewire: {time, radius: radius * 0.6},
    }
  }
  const center = {time, radius: Math.min(FADE_RADIUS, radius)}
  return {step, fadeOut: center, fadeIn: center, move: {time, radius}, easing: 'restructure', rewire: center}
}

/**
 * Layout easing for a step's move window: a pronounced ease-in-out (quintic
 * smootherstep) for every kind of step, so a move starts and ends softly and
 * a reversed comparison mirrors it exactly. Relationships morph on this same
 * clock as their cards.
 */
export function moveEasing(_easing: StepWindows['easing'], fraction: number): number {
  return smootherstep(fraction)
}

/**
 * The state after some number of steps: which entity rows are present, and
 * which rows (entities and relationships) already show their after version.
 */
export interface Stage {
  /** Entity row IDs present in this stage (and included, see `createStagedTimeline`). */
  active: ReadonlySet<string>
  /** Row IDs, entities and relationships, whose step has passed, so they show their After version. */
  settled: ReadonlySet<string>
}

/** A comparison's steps as stages and windows, from `createStagedTimeline`; every function is pure in `progress`. */
export interface StagedTimeline {
  /** `stages[0]` is the before state; `stages[k + 1]` follows step `k`. */
  stages: Stage[]
  /** Each scheduled step's windows (see `stepWindows`), in order: `windows[k]` moves `stages[k]` to `stages[k + 1]`. */
  windows: StepWindows[]
  /** The two stages a frame interpolates between, and how far. */
  at(progress: number): {from: number; to: number; mix: number}
  /** Opacity of an entity row: entering and leaving rows fade in their step's window. */
  presence(id: string, progress: number): number
  /** Progress through a row's own step, 0 before it starts and 1 after it ends; always 0 for a row no step changes. */
  local(id: string, progress: number): number
  /**
   * Presence of an entity row in a list: `size` is the share of its slot it
   * occupies, `opacity` its visibility. A removal fades, then its slot closes
   * during the step's move window; an addition's slot opens, then it fades in.
   * Both are 1 for survivors and 0 for rows absent at this point.
   */
  rowPresence(id: string, progress: number): {size: number; opacity: number}
  /** The version of a row a stage shows. */
  version<T>(row: EntityChange<T>, stage: Stage): T
  /** Relationships present in a stage, resolved to entity row endpoints. */
  relationships(stage: Stage): {row: EntityChange<Relationship>; from: string; to: string}[]
}

/**
 * Step-driven staging for renderers that interpolate between their own
 * layouts (trees, circle packings, lists). Compute one layout per stage, then draw
 * a frame by interpolating `stages[from]` to `stages[to]` by `mix`. Only one
 * step's move window is ever active, so layouts are never blended three ways.
 */
export function createStagedTimeline(
  model: ComparisonModel,
  schedule: readonly ScheduledStep[],
  options: {include?: ReadonlySet<string>} = {},
): StagedTimeline {
  const rows = new Map(model.entities.map(row => [row.id, row]))
  const included = (id: string) => !options.include || options.include.has(id)
  const windows = schedule.map(step => stepWindows(step, rows))
  const stepOf = new Map<string, StepWindows>()
  for (const entry of windows) for (const id of [...entry.step.entities, ...entry.step.relationships]) stepOf.set(id, entry)

  const active = new Set(model.entities.filter(row => row.before && included(row.id)).map(row => row.id))
  const settled = new Set<string>()
  const stages: Stage[] = [{active: new Set(active), settled: new Set(settled)}]
  for (const entry of windows) {
    for (const id of entry.step.entities) {
      const row = rows.get(id)
      if (!row || !included(id)) continue
      if (!row.after) active.delete(id)
      if (!row.before) active.add(id)
    }
    for (const id of [...entry.step.entities, ...entry.step.relationships]) settled.add(id)
    stages.push({active: new Set(active), settled: new Set(settled)})
  }
  // Rows outside every step settle at the midpoint, after any step centred before it.
  const unscheduled = new Set([...model.entities, ...model.relationships].map(row => row.id).filter(id => !stepOf.has(id)))

  const local = (id: string, progress: number) => {
    const t = unitProgress(progress)
    const entry = stepOf.get(id)
    // A row no step changes is the same on both sides; it never moves.
    return entry ? stepProgress(entry.step, t) : 0
  }
  const version = <T>(row: EntityChange<T>, stage: Stage): T => {
    const after = stage.settled.has(row.id) || (unscheduled.has(row.id) && stage === stages.at(-1))
    return (after ? (row.after ?? row.before) : (row.before ?? row.after))!
  }
  const presence = (id: string, progress: number): number => {
    const t = unitProgress(progress)
    const row = rows.get(id)
    if (!row) return 0
    const entry = stepOf.get(id)
    if (!row.before) {
      const window = entry?.fadeIn ?? unscheduledWindow
      return fadeIn(t, window.time, window.radius)
    }
    if (!row.after) {
      const window = entry?.fadeOut ?? unscheduledWindow
      return fadeOut(t, window.time, window.radius)
    }
    return 1
  }
  return {
    stages,
    windows,
    local,
    version,
    presence,
    at(progress) {
      const t = unitProgress(progress)
      let settledIndex = 0
      for (const [index, entry] of windows.entries()) {
        const start = entry.move.time - entry.move.radius,
          end = entry.move.time + entry.move.radius
        if (t < start) break
        if (t <= end && end > start) return {from: index, to: index + 1, mix: moveEasing(entry.easing, (t - start) / (end - start))}
        settledIndex = index + 1
      }
      return {from: settledIndex, to: settledIndex, mix: 0}
    },
    rowPresence(id, progress) {
      const t = unitProgress(progress)
      const row = rows.get(id)
      if (!row) return {size: 0, opacity: 0}
      const opacity = presence(id, t)
      if (row.before && row.after) return {size: 1, opacity}
      const entry = stepOf.get(id)
      if (!entry) return {size: opacity, opacity}
      const {time, radius} = entry.move
      const moved = moveEasing(entry.easing, radius > 0 ? unitProgress(0.5 + (t - time) / (2 * radius)) : t < time ? 0 : 1)
      return {size: row.after ? moved : 1 - moved, opacity}
    },
    relationships(stage) {
      const result: {row: EntityChange<Relationship>; from: string; to: string}[] = []
      for (const row of model.relationships) {
        const after = stage.settled.has(row.id) || (unscheduled.has(row.id) && stage === stages.at(-1))
        const side = after ? row.after : row.before
        if (!side) continue
        const from = (after ? model.entityRow.after : model.entityRow.before).get(side.from)
        const to = (after ? model.entityRow.after : model.entityRow.before).get(side.to)
        if (from && to && stage.active.has(from) && stage.active.has(to)) result.push({row, from, to})
      }
      return result
    },
  }
}
