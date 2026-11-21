// A frame's relationships: each route morphed, held or redrawn between the layouts, at its presence now.
import type {Point} from '../edge-arrows.js'
import type {GraphLayout} from '../layout.js'
import type {TransitionEdge, TransitionNode} from '../graph-transition.js'
import {ramp, smoothstep} from '../motion.js'
import {followEndpoints} from '../splines.js'
import type {Spline} from '../splines.js'
import {VISIBLE} from './geometry.js'
import type {Geometry} from './geometry.js'
import {directRoute, faceToFace, morphRoute, redrawPresence, smoothJoins} from './morph.js'
import type {Ends, Timing} from './timing.js'

const FADE_RADIUS = 0.055
/** How far, in layout units, a redrawn route may be dragged with its cards before it has faded out. */
const redrawReach = 4

export function frameEdges(input: {
  geometry: Geometry
  /** Every row's centre now, drawn or not. */
  points: ReadonlyMap<string, Point>
  /** The cards drawn. */
  nodes: readonly TransitionNode[]
  stages: readonly GraphLayout[]
  timing: Timing
  axis: Point
  t: number
}): TransitionEdge[] {
  const {points, nodes, stages, timing, axis, t} = input
  const {from, to, mix, redraw} = input.geometry
  const opacities = new Map(nodes.map(node => [node.id, node.opacity]))
  const sizes = new Map(nodes.map(node => [node.id, node]))
  // How far a card has moved from where a layout placed it.
  const offset = (id: string, layout: GraphLayout): Point => {
    const now = points.get(id)!,
      then = layout.points.get(id) ?? now
    return {x: now.x - then.x, y: now.y - then.y}
  }
  const route = (key: string, edge: Ends): Spline => {
    const a = from.routes.get(key),
      b = to.routes.get(key)
    const source = points.get(edge.from)!,
      target = points.get(edge.to)!
    // One layout's route kept as the same S (or failing that, dragged) between the cards where they are now.
    const held = (layout: GraphLayout) =>
      directRoute(key, layout, layout, 0, source, target, axis) ??
      smoothJoins(followEndpoints(layout.routes.get(key)!, offset(edge.from, layout), offset(edge.to, layout)))
    if (a && b && redraw?.has(key)) return held(mix < 0.5 ? from : to)
    // A route that is one S stays one S between its moving cards.
    const direct = directRoute(key, from, to, mix, source, target, axis)
    if (direct) return direct
    if (a && b) return smoothJoins(morphRoute(a, b, mix))
    // A route only one layout has (a relationship arriving or leaving) moves with its cards.
    const layout = a ? from : b ? to : stages.find(candidate => candidate.routes.has(key))
    if (layout) return held(layout)
    return faceToFace(points.get(edge.from)!, sizes.get(edge.from)!, points.get(edge.to)!, sizes.get(edge.to)!)
  }
  // A redrawn route is drawn only near the course its layout gave it: dragged along with its cards, it fades
  // before it could reach a neighbouring card (routes keep at least `edgeNode` spacing from cards).
  const redrawNearness = (edge: Ends) => {
    const layout = mix < 0.5 ? from : to
    const distance = (id: string) => {
      const {x, y} = offset(id, layout)
      return Math.hypot(x, y)
    }
    const moved = Math.max(distance(edge.from), distance(edge.to))
    return 1 - smoothstep(Math.min(1, moved / redrawReach))
  }
  const edges: TransitionEdge[] = []
  for (const {change, old, next, same, oldEvent, nextEvent, oldRadius, nextRadius} of timing.edgeAliases) {
    const add = (edge: Ends | undefined, presence: number, key: string) => {
      if (!edge) return
      const opacity =
        Math.min(presence, opacities.get(edge.from) ?? 0, opacities.get(edge.to) ?? 0) *
        (redraw?.has(key) ? redrawPresence(mix) * redrawNearness(edge) : 1)
      if (!points.has(edge.from) || !points.has(edge.to) || opacity <= VISIBLE) return
      const containment = (from.groups.has(edge.from) || to.groups.has(edge.from)) && (change.before ?? change.after)?.kind === 'contains'
      edges.push({
        ...change,
        fromId: edge.from,
        toId: edge.to,
        opacity,
        key,
        points: containment ? [] : route(key, edge),
        containment,
        shared: from.shared.has(key) || to.shared.has(key),
        local: timing.local(change.id, t),
      })
    }
    if (same && next) add(next, 1, change.id)
    else {
      add(old, 1 - ramp(t, oldEvent, Math.min(FADE_RADIUS, oldRadius)), `${change.id}:before`)
      add(next, ramp(t, nextEvent, Math.min(FADE_RADIUS, nextRadius)), `${change.id}:after`)
    }
  }
  return edges
}
