// The state shared by every phase of routing: the cards, their faces along the axis, and each route's segments.
import type {Point} from '../../edge-arrows.js'
import {polylinesCross} from '../../routes/crossings.js'
import {sampleSpline, type Spline} from '../../splines.js'
import type {LayoutEdge} from '../model.js'
import {straightRuns} from '../geometry.js'

export interface RouteBox {
  /** Centre. */
  x: number
  y: number
  width: number
  height: number
}

export interface RoutingInput {
  edges: readonly LayoutEdge[]
  /** ELK edges of each relationship: one, or two through a junction. */
  parts: ReadonlyMap<string, readonly string[]>
  /** Each ELK edge's endpoints: card IDs, or junction IDs (`j…`). */
  ends: ReadonlyMap<string, {from: string; to: string}>
  polylines: ReadonlyMap<string, Point[]>
  boxes: ReadonlyMap<string, RouteBox>
  cards: ReadonlySet<string>
  /** Cards with no relationships, placed in room the others leave: routes keep clear of them, but never run between them and the others. */
  loose?: ReadonlySet<string>
  direction: 'DOWN' | 'RIGHT'
  gap: number
  /** Whether the cards are on a grid of columns, so `polylines` go around every card (see `snapToGrid`). */
  grid?: boolean
}

/** Room kept between a direct S and any card it passes. */
export const routeClearance = 8

/** One ELK edge's stretch of a relationship's route. */
export interface Segment {
  key: string
  from: string
  to: string
  lead: boolean
  start: Point
  end?: Point
  route?: Spline
  bend?: readonly [number, number]
  /** Where its turns are confined (distances from `start`), for a direct S. */
  band?: readonly [number, number]
  /** Where its crossing run should be, as a distance from `start`, when it shares a gap (or must turn early or late). */
  run?: number
  /** Its crossing run's offset from the chosen band's middle (see `RouteOptions.track`). */
  track?: number
  /** Turns in a later gap rather than with its card's trunk, to keep clear of a converging route. */
  late?: boolean
  /** Follows ELK's course around the cards rather than one S, to keep clear of a converging route. */
  around?: boolean
  /** Leaves its card's out face across from its port (see `slide`), being the card's only route out. */
  slides?: boolean
}

export interface RoutingContext {
  input: RoutingInput
  cards: ReadonlySet<string>
  axis: Point
  /** Distance along the axis (across the layers). */
  along(point: Point): number
  /** Distance across the axis (along the layers). */
  across(point: Point): number
  at(alongValue: number, acrossValue: number): Point
  box(id: string): RouteBox
  /** A card's extent along the axis. */
  depth(id: string): number
  /** A card's extent across the axis. */
  breadth(id: string): number
  /** The middle of a card's out face. */
  outPort(id: string): Point
  /** Where a card's in face is along the axis. */
  inFace(id: string): number
  /** Each relationship's segments. */
  segments: Map<string, Segment[]>
  /** Segments into each card. */
  incoming: Map<string, Segment[]>
  /** Every segment (one list, never to be changed). */
  all(): readonly Segment[]
  /** The segments that share an end with a segment (its own included): those into its target and out of its source. */
  sharingAnEnd(segment: Segment): Segment[]
  /** Corridor routes found, by segment, and the ports they were found for (see `corridorRoute`). */
  corridors: Map<Segment, {memo: string; route: Spline | undefined}>
  /** Each route's straight runs across the layers. */
  crossRuns(route: Spline): {along: number; low: number; high: number}[]
  /** Whether two routes cross, away from `ignore`, testing only routes whose bounds touch. */
  quickCross(a: Spline, b: Spline, ignore: readonly Point[], radius: number): boolean
  /** How many routes sharing an end with a segment its route crosses: moving a route must not add any. */
  crossingsOf(segment: Segment): number
  /** Whether a route keeps `routeClearance` from every card but its own. */
  clear(route: Spline, own: readonly string[]): boolean
  /** Where the next layer of cards begins after a card: the nearest card face beyond its out face. */
  firstGap(id: string): number
  /** The far face of the last layer of cards before a card: where the gap above its in face begins. */
  previousLayer(id: string): number
  /** How much wider the layer gap must grow for parallel runs to keep full turns. */
  crowding: number
}

export function routingContext(input: RoutingInput): RoutingContext {
  const {boxes, cards, direction} = input
  const axis = direction === 'DOWN' ? {x: 0, y: 1} : {x: 1, y: 0}
  const along = (point: Point) => point.x * axis.x + point.y * axis.y
  const across = (point: Point) => point.x * axis.y + point.y * axis.x
  const at = (alongValue: number, acrossValue: number): Point =>
    direction === 'DOWN' ? {x: acrossValue, y: alongValue} : {x: alongValue, y: acrossValue}
  const box = (id: string) => boxes.get(id)!
  const depth = (id: string) => (direction === 'DOWN' ? box(id).height : box(id).width)
  const breadth = (id: string) => (direction === 'DOWN' ? box(id).width : box(id).height)
  const outPort = (id: string) => at(along(box(id)) + depth(id) / 2, across(box(id)))
  const inFace = (id: string) => along(box(id)) - depth(id) / 2

  const segments = new Map<string, Segment[]>()
  const incoming = new Map<string, Segment[]>()
  for (const edge of input.edges) {
    const keys = input.parts.get(edge.id)!
    const list = keys.map((key, index): Segment => {
      const {from, to} = input.ends.get(key)!
      return {key, from, to, lead: index === keys.length - 1, start: outPort(from)}
    })
    for (const segment of list) {
      if (!cards.has(segment.to)) segment.end = {x: box(segment.to).x, y: box(segment.to).y}
      else incoming.set(segment.to, [...(incoming.get(segment.to) ?? []), segment])
    }
    segments.set(edge.id, list)
  }
  // The segments never change once made, only their routes: one list, and each card's segments by end.
  const every = [...segments.values()].flat()
  const all = () => every
  const leaving = new Map<string, Segment[]>(),
    arriving = new Map<string, Segment[]>()
  for (const segment of every) {
    leaving.set(segment.from, [...(leaving.get(segment.from) ?? []), segment])
    arriving.set(segment.to, [...(arriving.get(segment.to) ?? []), segment])
  }
  const sharingAnEnd = (segment: Segment) => [
    ...(arriving.get(segment.to) ?? []),
    ...(leaving.get(segment.from) ?? []).filter(other => other.to !== segment.to),
  ]
  const leavers = new Map<string, number>()
  for (const segment of all()) leavers.set(segment.from, (leavers.get(segment.from) ?? 0) + 1)
  for (const segment of all()) {
    if (cards.has(segment.from) && cards.has(segment.to) && leavers.get(segment.from) === 1) segment.slides = true
  }

  // Each route's samples and bounds, kept while the route is unchanged: crossing tests skip routes that can't touch.
  const sampledRoutes = new WeakMap<Spline, {points: Point[]; box: readonly [number, number, number, number]}>()
  const sampled = (route: Spline) => {
    let value = sampledRoutes.get(route)
    if (!value) {
      // Routes keep a track (10) apart, so 6-unit samples find every crossing.
      const points = sampleSpline(route, 6)
      const xs = points.map(point => point.x),
        ys = points.map(point => point.y)
      value = {points, box: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]}
      sampledRoutes.set(route, value)
    }
    return value
  }
  // Each route's straight runs across the layers, kept while the route is unchanged.
  const crossRunsOf = new WeakMap<Spline, {along: number; low: number; high: number}[]>()
  const crossRuns = (route: Spline) => {
    let value = crossRunsOf.get(route)
    if (!value) {
      value = straightRuns(route)
        .filter(run => Math.abs(along(run.to) - along(run.from)) < 0.01)
        .map(run => ({
          along: along(run.from),
          low: Math.min(across(run.from), across(run.to)),
          high: Math.max(across(run.from), across(run.to)),
        }))
      crossRunsOf.set(route, value)
    }
    return value
  }
  const quickCross = (a: Spline, b: Spline, ignore: readonly Point[], radius: number) => {
    const p = sampled(a),
      q = sampled(b)
    if (p.box[1] < q.box[0] || q.box[1] < p.box[0] || p.box[3] < q.box[2] || q.box[3] < p.box[2]) return false
    return polylinesCross(p.points, q.points, ignore, radius)
  }
  const crossingsOf = (segment: Segment) =>
    sharingAnEnd(segment).filter(
      other =>
        other !== segment &&
        other.route &&
        quickCross(
          segment.route!,
          other.route,
          [segment.end!, other.end!, ...(other.from === segment.from ? [segment.start] : [])],
          other.from === segment.from ? 6 : 3,
        ),
    ).length
  // Cards' clearance boxes, kept for the whole routing.
  const clearance = new Map(
    [...cards].map(id => {
      const card = box(id)
      return [
        id,
        [
          card.x - card.width / 2 - routeClearance,
          card.x + card.width / 2 + routeClearance,
          card.y - card.height / 2 - routeClearance,
          card.y + card.height / 2 + routeClearance,
        ] as const,
      ]
    }),
  )
  const clear = (route: Spline, own: readonly string[]) => {
    const samples = sampleSpline(route, 4)
    // Runs of samples with their bounds: a card is tested only against the runs that reach it.
    const runs: {from: number; to: number; box: readonly [number, number, number, number]}[] = []
    for (let from = 0; from < samples.length; from += 16) {
      const to = Math.min(samples.length, from + 16)
      let left = Infinity,
        right = -Infinity,
        top = Infinity,
        bottom = -Infinity
      for (let index = from; index < to; index++) {
        const {x, y} = samples[index]!
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
      runs.push({from, to, box: [left, right, top, bottom]})
    }
    for (const [id, [left, right, top, bottom]] of clearance) {
      if (own.includes(id)) continue
      for (const run of runs) {
        if (run.box[1] <= left || run.box[0] >= right || run.box[3] <= top || run.box[2] >= bottom) continue
        for (let index = run.from; index < run.to; index++) {
          const point = samples[index]!
          if (point.x > left && point.x < right && point.y > top && point.y < bottom) return false
        }
      }
    }
    return true
  }
  const nextLayer = new Map<string, number>()
  const firstGap = (id: string) => {
    let value = nextLayer.get(id)
    if (value === undefined) {
      const face = along(box(id)) + depth(id) / 2
      value = Infinity
      for (const other of cards) {
        const near = along(box(other)) - depth(other) / 2
        if (other !== id && near > face + 1) value = Math.min(value, near)
      }
      nextLayer.set(id, value)
    }
    return value
  }
  const previousLayer = (id: string) => {
    const face = inFace(id)
    let value = -Infinity
    for (const other of cards) {
      const far = along(box(other)) + depth(other) / 2
      if (other !== id && far < face - 1) value = Math.max(value, far)
    }
    return value
  }
  return {
    input,
    cards,
    axis,
    along,
    across,
    at,
    box,
    depth,
    breadth,
    outPort,
    inFace,
    segments,
    incoming,
    all,
    sharingAnEnd,
    corridors: new Map(),
    crossRuns,
    quickCross,
    crossingsOf,
    clear,
    firstGap,
    previousLayer,
    crowding: 0,
  }
}
