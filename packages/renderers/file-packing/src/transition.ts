import type {Entity} from '@githubnext/projections-schemas'
import {compareIds, createStagedTimeline, type ComparisonModel, type ScheduledStep} from '@githubnext/projections-renderer-kit'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {separate} from './pack/arrange.js'
import type {PackSettings} from './pack/hierarchy.js'
import {packSnapshot, type Packing, type Placement} from './pack/packing.js'
import {sideSnapshot, stageSnapshot, unionSnapshot} from './snapshots.js'

/** A circle as drawn at one progress. */
export interface Circle extends Placement {
  id: string
  row: EntityChange<Entity>
  opacity: number
  /** Progress through the row's own step (0 before it, 1 after). */
  local: number
}

export interface PackingTransition {
  /** Circles at a progress, parents before children. */
  frame(progress: number): Circle[]
  /** The row of the single root holding everything (drawn as the background, not a circle), and its opacity at a progress. */
  root?: {id: string; opacity(progress: number): number}
  /** The packing of the first and last stage, for sizes and deltas. */
  first: Packing
  last: Packing
}

function collapsed(placement: Placement): Placement {
  return {...placement, r: 0, value: 0}
}

/**
 * Keeps an interpolated frame free of collisions. Two packings that are each
 * free of overlaps can pass circles through each other halfway between them,
 * so while circles move, each folder's children (top level first) are pushed
 * apart and kept inside their folder, and every circle carries its contents
 * along. Circles that have finished leaving don't take room; arriving ones,
 * still transparent while their room opens, do. A settled frame has no
 * overlaps, so the endpoints are untouched.
 */
export function settle(circles: Circle[]): void {
  const children = new Map<string | undefined, Circle[]>()
  for (const circle of circles) (children.get(circle.parent) ?? children.set(circle.parent, []).get(circle.parent)!).push(circle)
  const byId = new Map(circles.map(circle => [circle.id, circle]))
  const visit = (parent: string | undefined, dx: number, dy: number) => {
    const kids = children.get(parent) ?? []
    for (const kid of kids) {
      kid.x += dx
      kid.y += dy
    }
    const room = kids.filter(kid => kid.r > 0 && !(kid.opacity <= 0.01 && !kid.row.after))
    const moving = room.map(kid => ({x: kid.x, y: kid.y, r: kid.r, key: kid.id}))
    const outer = parent === undefined ? undefined : byId.get(parent)
    const contain = () => {
      if (!outer) return
      for (const circle of moving) {
        const offsetX = circle.x - outer.x,
          offsetY = circle.y - outer.y
        const distance = Math.hypot(offsetX, offsetY),
          limit = Math.max(0, outer.r - circle.r)
        if (distance > limit && distance > 0) {
          circle.x = outer.x + (offsetX / distance) * limit
          circle.y = outer.y + (offsetY / distance) * limit
        }
      }
    }
    for (let pass = 0; pass < 400; pass++) {
      const moved = separate(moving, 0)
      contain()
      if (!moved) break
    }
    const moved = new Map(moving.map(circle => [circle.key, circle]))
    for (const kid of kids) {
      const target = moved.get(kid.id)
      const ownX = target ? target.x - kid.x : 0,
        ownY = target ? target.y - kid.y : 0
      kid.x += ownX
      kid.y += ownY
      visit(kid.id, dx + ownX, dy + ownY)
    }
  }
  visit(undefined, 0, 0)
}

/**
 * Staged circle packing. Each stage (the state after each comparison step)
 * is packed into the same area; a frame interpolates between the two stages
 * of the step moving now. A removed file fades out first, then its circle
 * closes while its neighbours take the room; an added file's room opens
 * first, then it fades in where it belongs; a resized file grows or shrinks
 * with its step. Rows absent from a stage collapse in place, so nothing
 * travels from elsewhere.
 */
export function createPackingTransition(
  model: ComparisonModel,
  schedule: readonly ScheduledStep[],
  settings: PackSettings,
  size: {width: number; height: number},
  include?: ReadonlySet<string>,
): PackingTransition {
  const timeline = createStagedTimeline(model, schedule, include ? {include} : {})
  const rows = new Map(model.entities.map(row => [row.id, row]))
  // Each stage continues from the one before it, so circles only move where something changed.
  const layouts: Packing[] = []
  for (const stage of timeline.stages) {
    layouts.push(packSnapshot(stageSnapshot(model, timeline, stage), settings, size, layouts.length ? {previous: layouts.at(-1)!} : {}))
  }
  const root = layouts.find(layout => layout.root !== undefined)?.root
  return {
    first: layouts[0]!,
    last: layouts.at(-1)!,
    ...(root === undefined ? {} : {root: {id: root, opacity: (progress: number) => timeline.presence(root, progress)}}),
    frame(progress) {
      const {from, to, mix} = timeline.at(progress)
      const start = layouts[from]!.placements,
        end = layouts[to]!.placements
      const circles: Circle[] = []
      for (const id of new Set([...start.keys(), ...end.keys()])) {
        const a = start.get(id) ?? collapsed(end.get(id)!),
          b = end.get(id) ?? collapsed(start.get(id)!)
        const lerp = (p: number, q: number) => p + (q - p) * mix
        const later = mix < 0.5 ? a : b
        const circle: Circle = {
          id,
          row: rows.get(id)!,
          x: lerp(a.x, b.x),
          y: lerp(a.y, b.y),
          r: lerp(a.r, b.r),
          value: lerp(a.value, b.value),
          depth: later.depth,
          filled: later.filled,
          ...(later.parent === undefined ? {} : {parent: later.parent}),
          ...((later.category ?? a.category ?? b.category) === undefined ? {} : {category: (later.category ?? a.category ?? b.category)!}),
          opacity: timeline.presence(id, progress),
          local: timeline.local(id, progress),
        }
        circles.push(circle)
      }
      if (mix > 0 && mix < 1) settle(circles)
      return circles
        .filter(circle => circle.opacity > 1e-6 && circle.r > 0.05)
        .sort((left, right) => left.depth - right.depth || compareIds(left.id, right.id))
    },
  }
}

/**
 * The diff: one packing of the union of both revisions at the after
 * revision's scale, so files that didn't change keep their size, with
 * removed files where they were and added files where they are.
 */
export function diffPacking(
  model: ComparisonModel,
  settings: PackSettings,
  size: {width: number; height: number},
  include?: ReadonlySet<string>,
): {packing: Packing; circles: Circle[]; before: Packing; after: Packing} {
  // As in the animation: the after revision continues from the before one, and the union from the before one at
  // the after scale, so files keep their places and unchanged files keep their size.
  const before = packSnapshot(sideSnapshot(model, 'before', include), settings, size)
  const after = packSnapshot(sideSnapshot(model, 'after', include), settings, size, {previous: before})
  const packing = packSnapshot(unionSnapshot(model, include), settings, size, {
    fixed: after.placements.size ? after : before,
    previous: before,
  })
  const rows = new Map(model.entities.map(row => [row.id, row]))
  const circles = [...packing.placements]
    .map(([id, placement]) => ({...placement, id, row: rows.get(id)!, opacity: 1, local: 1}))
    .sort((left, right) => left.depth - right.depth || compareIds(left.id, right.id))
  return {packing, circles, before, after}
}
