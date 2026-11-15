// One frame of a staged graph transition: its cards where the layouts put them now, faded in or out.
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {Point} from '../edge-arrows.js'
import type {GraphLayout} from '../layout.js'
import type {GraphFrame, TransitionNode} from '../graph-transition.js'
import {ramp, unitProgress} from '../motion.js'
import {frameEdges} from './frame-edges.js'
import {geometry, VISIBLE} from './geometry.js'
import type {LayoutMove} from './geometry.js'
import {interpolate} from './morph.js'
import type {Timing} from './timing.js'

export function transitionFrame(input: {
  entities: readonly EntityChange<Entity>[]
  timing: Timing
  /** Every layout, in step order. */
  stages: readonly GraphLayout[]
  events: readonly LayoutMove[]
  axis: Point
}): (progress: number) => GraphFrame {
  const {entities, timing, stages, events, axis} = input
  const {entering, leaving, local} = timing
  const initial = stages[0]!

  function nodePoint(id: string, primary: GraphLayout, secondary: GraphLayout): Point {
    const point = primary.points.get(id) ?? secondary.points.get(id) ?? stages.find(layout => layout.points.has(id))?.points.get(id)
    if (!point) throw new Error(`Missing layout position for node ${id}`)
    return point
  }

  return (progress: number): GraphFrame => {
    const t = unitProgress(progress)
    const at = geometry(events, initial, t)
    const {from, to, mix, width, height} = at
    const points = new Map<string, Point>()
    const nodes: TransitionNode[] = []
    for (const row of entities) {
      const appearance = entering(row.id)
      const disappearance = leaving(row.id)
      // Cards fade evenly (smoothstep, its own mirror), so a leaving card is visibly translucent through its window
      // rather than holding nearly opaque and vanishing at the end.
      const opacity = appearance
        ? ramp(t, appearance.time, appearance.radius)
        : disappearance
          ? 1 - ramp(t, disappearance.time, disappearance.radius)
          : 1
      const a = nodePoint(row.id, from, to)
      const b = nodePoint(row.id, to, from)
      const point = {x: interpolate(a.x, b.x, mix), y: interpolate(a.y, b.y, mix)}
      const sizeA = from.sizes.get(row.id) ?? to.sizes.get(row.id) ?? stages.find(layout => layout.sizes.has(row.id))!.sizes.get(row.id)!
      const sizeB = to.sizes.get(row.id) ?? sizeA
      points.set(row.id, point)
      if (opacity <= VISIBLE) continue
      nodes.push({
        ...row,
        ...point,
        width: interpolate(sizeA.width, sizeB.width, mix),
        height: interpolate(sizeA.height, sizeB.height, mix),
        group: from.groups.has(row.id) || to.groups.has(row.id),
        opacity,
        local: local(row.id, t),
      })
    }
    const edges = frameEdges({geometry: at, points, nodes, stages, timing, axis, t})
    return {nodes, edges, junctions: mix === 0 ? from.junctions : [], width, height}
  }
}
