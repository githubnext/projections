// Relationship routes between laid-out cards.
import {joinSplines} from '../splines.js'
import type {Spline} from '../splines.js'
import type {RoutePorts} from './model.js'
import {build} from './routing/build.js'
import {routingContext} from './routing/context.js'
import type {RoutingInput} from './routing/context.js'
import {untangleConverging} from './routing/converge.js'
import {assign, byLeaving} from './routing/ports.js'
import {separateRuns} from './routing/separate.js'
import {swapCrossingTrunks} from './routing/trunk-swaps.js'

/**
 * Every relationship's route, drawn as one S between its cards' ports
 * (`sBend`) wherever that S passes clear of every other card, and otherwise
 * along ELK's orthogonal course around them, one S per jog (`smoothRoute`).
 * A card's outgoing relationships share one port, the middle of its out face,
 * so they leave together and part as they turn. Its incoming relationships
 * get ports spread over its in face in the order they approach, so routes
 * converging on one card never cross.
 */
export function routeEdges(input: RoutingInput): {routes: Map<string, Spline>; ports: Map<string, RoutePorts>; crowding: number} {
  const ctx = routingContext(input)
  // First where each route leaves its source, then where it enters the gap above the target.
  for (const [target, list] of ctx.incoming) assign(ctx, target, byLeaving(ctx, list))
  for (const list of ctx.segments.values()) for (const segment of list) build(ctx, segment)
  separateRuns(ctx)
  untangleConverging(ctx)
  // Turns moved to keep converging routes apart may now lie on another gap's runs: separate them again.
  separateRuns(ctx)
  // Last, two direct routes into one card that still cross change places with their trunks.
  swapCrossingTrunks(ctx)

  const routes = new Map<string, Spline>()
  const ports = new Map<string, RoutePorts>()
  for (const edge of input.edges) {
    const list = ctx.segments.get(edge.id)!
    const route = list.map(segment => segment.route!).reduce(joinSplines)
    if (route.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      throw new Error(`Graph layout did not produce a route for "${edge.id}".`)
    }
    routes.set(edge.id, route)
    const source = ctx.box(edge.from),
      target = ctx.box(edge.to)
    ports.set(edge.id, {
      from: {x: route[0]!.x - source.x, y: route[0]!.y - source.y},
      to: {x: route.at(-1)!.x - target.x, y: route.at(-1)!.y - target.y},
      ...(list.length === 1 && list[0]!.bend ? {bend: list[0]!.bend, ...(list[0]!.track ? {track: list[0]!.track} : {})} : {}),
    })
  }
  return {routes, ports, crowding: ctx.crowding}
}
