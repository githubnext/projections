// A presentation frame: every item at one progress, timed by the comparison's steps.
import type {Entity, Extraction, Relationship} from '@githubnext/projections-schemas'
import {emphasisRise, scheduleSteps, stepProgress} from '../schedule.js'
import type {ScheduledStep} from '../schedule.js'
import type {PresentedOrder} from '../steps.js'
import {snapshotChanges} from './changes.js'
import type {EntityChange, PresentedChanges} from './changes.js'
import {diffEmphasis, phaseProgress, stepPhases, unit} from './progress.js'

/**
 * Visibility of an item at `local`, its progress through its own comparison
 * step's motion (`stepProgress`, which waits out the step's reading lead): a
 * removal fades out in the first phase and an addition fades in in the last
 * (`stepPhases`).
 */
export function presence(change: EntityChange<Entity | Relationship>, local: number): number {
  if (change.before && change.after) return 1
  if (change.before) return 1 - phaseProgress(local, stepPhases.fadeOut)
  return phaseProgress(local, stepPhases.fadeIn)
}

/** One item of a `PresentationFrame`: the version to draw now and how strongly. */
export interface Presented<T> {
  /** The item's row ID (`EntityChange.id`), stable across the transition. */
  id: string
  /** The version to draw: `before` until halfway through the item's step, then `after` (whichever exists). */
  entity: T
  /** The item's row, with both versions and its status. */
  change: EntityChange<T>
  /** Visibility from 0 to 1 (`presence`); items at 0 are left out of the frame. */
  opacity: number
  /** Change emphasis from 0 to 1: the frame's `emphasis` scaled by `rise`; 0 for an unchanged, unrenamed item. */
  emphasis: number
  /** Progress through this item's own comparison step: 0 before it, 1 after it; 0 for an item no step changes, 1 in an extraction. */
  local: number
  /** Share of the change highlighting this item shows now (`emphasisRise`): 0 before its step begins. */
  rise: number
}
/** A relationship of a `PresentationFrame`, with its endpoints resolved to the frame's entity rows. */
export interface PresentedEdge extends Presented<Relationship> {
  /** The source entity's row ID (`Presented.id`), which may differ from `entity.from` after a rename. */
  from: string
  /** The target entity's row ID (`Presented.id`), which may differ from `entity.to` after a rename. */
  to: string
}
/** Every visible item at one progress, as `createFrame` presents it. */
export interface PresentationFrame {
  /** The host's progress. */
  progress: number
  /**
   * The staged clock: the share of the comparison's steps whose motion phase
   * (`stepPhases.move`) has completed. It only moves inside step windows. Use
   * it for motion shared by many items (a whole layout); time individual items
   * by their `local` progress.
   */
  staged: number
  /** The host-style change emphasis at `progress` (`diffEmphasis`): 0 at both endpoints and for an extraction. */
  emphasis: number
  /** The visible entities, in row ID order. */
  nodes: Presented<Entity>[]
  /** The visible relationships, in row ID order, each never more opaque than its endpoints. */
  edges: PresentedEdge[]
  /** The steps on the progress axis this frame was timed by (empty for an extraction). */
  schedule: ScheduledStep[]
}

/** How `createFrame` times a comparison. */
export interface FrameOptions {
  /**
   * The direction of travel this transition presents, from a `DirectionLatch`
   * (default 1). It matters only for a comparison with explicit `reverseSteps`.
   */
  direction?: 1 | -1
  /** A schedule to time the frame by; defaults to `scheduleSteps(changes, direction)`. */
  schedule?: readonly ScheduledStep[]
}

/**
 * Present comparator results at `progress`, following the comparison's steps:
 * every entity and relationship fades, switches version and crossfades a
 * rewiring only inside its own step's window (`scheduleSteps`, with the
 * shared hold policy between steps), so a custom comparator's order is what
 * plays and shapes settle between steps while progress keeps moving. Pairs
 * built by hand, without steps, change together in one step. Relationships
 * never outlive their endpoints. Never infers identity or computes semantic
 * changes. Report `stepEnds(frame.schedule, direction)` to the host.
 */
export function createFrame(after: Extraction, changes?: PresentedChanges, progress = 1, options: FrameOptions = {}): PresentationFrame {
  if (!changes) {
    const nodes = snapshotChanges(after.entities).map(change => ({
      id: change.id,
      entity: change.after!,
      change,
      opacity: 1,
      emphasis: 0,
      local: 1,
      rise: 0,
    }))
    const edges = snapshotChanges(after.relationships).map(change => ({
      id: change.id,
      entity: change.after!,
      change,
      from: change.after!.from,
      to: change.after!.to,
      opacity: 1,
      emphasis: 0,
      local: 1,
      rise: 0,
    }))
    return {progress: 1, staged: 1, emphasis: 0, nodes, edges, schedule: []}
  }
  const t = unit(progress)
  const order: PresentedOrder = changes.steps
    ? {steps: changes.steps, reverse: changes.reverse ?? 'mirror', ...(changes.reverseSteps ? {reverseSteps: changes.reverseSteps} : {})}
    : {
        reverse: 'mirror',
        steps: [
          {
            index: 0,
            kind: 'restructure',
            entities: changes.entities.filter(change => change.status !== 'unchanged' || change.renamed).map(change => change.id),
            relationships: changes.relationships.filter(change => change.status !== 'unchanged' || change.renamed).map(change => change.id),
            removes: [...changes.entities, ...changes.relationships].some(change => change.status === 'removed'),
            adds: [...changes.entities, ...changes.relationships].some(change => change.status === 'added'),
          },
        ],
      }
  const schedule = [...(options.schedule ?? scheduleSteps(order, options.direction ?? 1))]
  const stepOf = new Map<string, ScheduledStep>()
  for (const step of schedule) for (const id of [...step.entities, ...step.relationships]) stepOf.set(id, step)
  const local = (id: string) => {
    const step = stepOf.get(id)
    return step ? stepProgress(step, t) : 0
  }
  const rise = (id: string) => emphasisRise(stepOf.get(id), t)
  const staged = schedule.length
    ? schedule.reduce((sum, step) => sum + phaseProgress(stepProgress(step, t), stepPhases.move), 0) / schedule.length
    : t >= 1
      ? 1
      : 0
  const emphasis = diffEmphasis(t)
  const aliases = new Map<string, string>()
  const nodes: Presented<Entity>[] = []
  for (const change of changes.entities) {
    if (change.before) aliases.set(change.before.id, change.id)
    if (change.after) aliases.set(change.after.id, change.id)
    const q = local(change.id)
    const entity = q < 0.5 ? (change.before ?? change.after) : (change.after ?? change.before)
    if (!entity) throw new Error(`Comparison node ${change.id} has no entity`)
    const opacity = presence(change, q)
    const scale = rise(change.id)
    if (opacity > 0) {
      nodes.push({
        id: change.id,
        entity,
        change,
        opacity,
        emphasis: change.status === 'unchanged' && !change.renamed ? 0 : emphasis * scale,
        local: q,
        rise: scale,
      })
    }
  }
  const visible = new Map(nodes.map(node => [node.id, node.opacity]))
  const edges: PresentedEdge[] = []
  for (const change of changes.relationships) {
    const q = local(change.id)
    const entity = q < 0.5 ? (change.before ?? change.after) : (change.after ?? change.before)
    if (!entity) throw new Error(`Comparison edge ${change.id} has no entity`)
    const from = aliases.get(entity.from) ?? entity.from
    const to = aliases.get(entity.to) ?? entity.to
    let opacity = presence(change, q)
    // A relationship rewired between other entities crossfades within its own step.
    if (
      change.before &&
      change.after &&
      (aliases.get(change.before.from) !== aliases.get(change.after.from) || aliases.get(change.before.to) !== aliases.get(change.after.to))
    ) {
      opacity *= q < 0.5 ? 1 - phaseProgress(q, stepPhases.fadeOut) : phaseProgress(q, stepPhases.fadeIn)
    }
    opacity = Math.min(opacity, visible.get(from) ?? 0, visible.get(to) ?? 0)
    const scale = rise(change.id)
    if (opacity > 0) {
      edges.push({
        id: change.id,
        entity,
        change,
        from,
        to,
        opacity,
        emphasis: change.status === 'unchanged' && !change.renamed ? 0 : emphasis * scale,
        local: q,
        rise: scale,
      })
    }
  }
  return {progress: t, staged, emphasis, nodes, edges, schedule}
}
