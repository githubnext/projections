// When each row of a staged graph transition changes: its own step's progress, and when relationships fade.
import type {Entity, Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {ComparisonModel} from '../model.js'
import {type ScheduledStep, stepProgress} from '../timeline.js'
import {unitProgress} from '../motion.js'
import {stepWindows, unscheduledWindow, type StepWindows, type Window} from '../stages.js'

/** A relationship's endpoints, as entity row IDs. */
export interface Ends {
  from: string
  to: string
}

/**
 * A relationship as the transition draws it: its endpoints in each revision, whether they are the same, and when its
 * old route fades out and its new one fades in.
 */
export interface EdgeAlias {
  change: EntityChange<Relationship>
  old: Ends | undefined
  next: Ends | undefined
  same: boolean
  oldEvent: number
  nextEvent: number
  oldRadius: number
  nextRadius: number
}

export interface Timing {
  /** The windows of each scheduled step, in schedule order. */
  windows: StepWindows[]
  /** Progress through a row's own step at `t` (see `TransitionNode.local`). */
  local: (id: string, t: number) => number
  /** A row's revision shown at `moment`: the one before its step's middle, then the one after. */
  displayed: <T>(row: EntityChange<T>, moment: number) => T
  /** Where an arriving row fades in. */
  entering: (id: string) => Window | undefined
  /** Where a leaving row fades out. */
  leaving: (id: string) => Window | undefined
  /** Every relationship between included rows. */
  edgeAliases: EdgeAlias[]
}

/** When the rows of `model` (those in `rows`, the included ones) change, for the steps of `schedule`. */
export function transitionTiming(
  model: ComparisonModel,
  schedule: readonly ScheduledStep[],
  rows: ReadonlyMap<string, EntityChange<Entity>>,
): Timing {
  const allRows = new Map(model.entities.map(row => [row.id, row]))
  const windows = schedule.map(step => stepWindows(step, allRows))
  const stepOf = new Map<string, StepWindows>()
  for (const entry of windows) for (const id of [...entry.step.entities, ...entry.step.relationships]) stepOf.set(id, entry)

  const local = (id: string, t: number) => {
    const entry = stepOf.get(id)
    // A row no step changes is the same on both sides; it never moves.
    return entry ? stepProgress(entry.step, unitProgress(t)) : 0
  }
  const displayed = <T>(row: EntityChange<T>, moment: number): T =>
    (local(row.id, moment) < 0.5 ? (row.before ?? row.after) : (row.after ?? row.before))!

  const entering = (id: string) => (!rows.get(id)?.before ? stepOf.get(id)?.fadeIn : undefined)
  const leaving = (id: string) => (!rows.get(id)?.after ? stepOf.get(id)?.fadeOut : undefined)
  const edgeAliases = model.relationships.flatMap(change => edgeAlias(model, change, rows, stepOf.get(change.id), entering, leaving))
  return {windows, local, displayed, entering, leaving, edgeAliases}
}

function edgeAlias(
  model: ComparisonModel,
  change: EntityChange<Relationship>,
  rows: ReadonlyMap<string, EntityChange<Entity>>,
  entry: StepWindows | undefined,
  entering: (id: string) => Window | undefined,
  leaving: (id: string) => Window | undefined,
): EdgeAlias[] {
  const fallback: Window = unscheduledWindow
  const old = change.before && {from: model.entityRow.before.get(change.before.from)!, to: model.entityRow.before.get(change.before.to)!}
  const next = change.after && {from: model.entityRow.after.get(change.after.from)!, to: model.entityRow.after.get(change.after.to)!}
  const included = (edge?: Ends) => !edge || (rows.has(edge.from) && rows.has(edge.to))
  if (!included(old) || !included(next)) return []
  const same = Boolean(old && old.from === next?.from && old.to === next.to)
  const oldWindow = !old
    ? undefined
    : entry
      ? change.after
        ? entry.rewire
        : entry.fadeOut
      : (leaving(old.from) ?? leaving(old.to) ?? fallback)
  const nextWindow = !next
    ? undefined
    : entry
      ? change.before
        ? entry.rewire
        : entry.fadeIn
      : (entering(next.from) ?? entering(next.to) ?? fallback)
  return [
    {
      change,
      old,
      next,
      same,
      oldEvent: oldWindow?.time ?? 1,
      nextEvent: nextWindow?.time ?? 0,
      oldRadius: oldWindow?.radius ?? unscheduledWindow.radius,
      nextRadius: nextWindow?.radius ?? unscheduledWindow.radius,
    },
  ]
}
