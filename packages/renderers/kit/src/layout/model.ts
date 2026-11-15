// The layout's inputs and results, card sizes and the ID order every stage sorts by.
import type {Point} from '../edge-arrows.js'
import type {Spline} from '../splines.js'
import type {Alignment} from './alignment.js'

/** Code-unit order, the same order the Engine uses for IDs. */
export function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
/** A relationship to lay out (see `layoutGraph`). One with an endpoint missing from the nodes is left out. */
export interface LayoutEdge {
  /** Unique among the edges: the key of its route in `GraphLayout.routes`. */
  id: string
  /** The source node's ID. */
  from: string
  /** The target node's ID. */
  to: string
  /** The relationship's kind: a `contains` edge from a compound boundary draws as the boundary, with no route. */
  kind: string
}

/** A laid-out graph from `layoutGraph`, in layout units (CSS px at a zoom of 1). Shared: never change it. */
export interface GraphLayout {
  /** Card and boundary centres. */
  points: Map<string, Point>
  /** Card and boundary sizes, keyed like `points`; a boundary is as large as it needs to enclose its members. */
  sizes: Map<string, {width: number; height: number}>
  /** Relationship routes by layout edge ID (see `Spline`), in the cards' coordinates. */
  routes: Map<string, Spline>
  /** Compound module boundaries and their direct members. */
  groups: Map<string, string[]>
  /** Join/split points of shared-prerequisite stages (see `GraphLayoutOptions.junctions`). */
  junctions: Point[]
  /** Edges routed through a junction. */
  shared: Set<string>
  /** Where each route leaves and enters its cards, and where its S bends (see `RoutePorts`). */
  ports: Map<string, RoutePorts>
  /** The space between layers this layout used (see `GraphLayoutOptions.layerGap`). */
  layerGap: number
  /** How this layout placed its cards (see `GraphLayoutOptions.alignment`). */
  alignment: GraphAlignment
  /** The width of the drawing, everything in it, its padding included. */
  width: number
  /** The height of the drawing, everything in it, its padding included. */
  height: number
}

/**
 * Where a route leaves and enters its cards, relative to the card centres,
 * and, for a route that is one S, where along it the S bends: from `bend[0]`
 * after the source port to `bend[1]` before the end of the bend's span (the
 * start of the arrowhead's lead-in). Transitions redraw such routes as one S
 * between the moving cards with these values interpolated (`gappedBend`)
 * rather than morphing control points, so they stay one clean S in every frame.
 */
export interface RoutePorts {
  /** Where the route leaves its source, relative to the source card's centre. */
  from: Point
  /** Where the route enters its target, relative to the target card's centre. */
  to: Point
  /** A direct S's band: how far after the source and before the lead-in its turns are confined (see `gappedBend`). */
  bend?: readonly [number, number]
  /** The S's track in a gap it shares: how far its crossing run sits from the band's middle. */
  track?: number
}

/** How `layoutGraph` lays out a graph; every option has a default. */
export interface GraphLayoutOptions {
  /** The layers' direction: `vertical` (the default) runs top to bottom, `horizontal` left to right. */
  orientation?: 'vertical' | 'horizontal'
  /**
   * Group unambiguous containment-only entities into compound boundaries:
   * `true` for `module`s (architecture), or the entity kinds that may become
   * boundaries (infrastructure: modules, resource groups, parent resources).
   */
  compound?: boolean | readonly string[]
  /**
   * Compound boundaries that stay boundaries even when nothing is left in them (see `moduleGroups`): a transition
   * passes its union's, so no boundary turns into a card between steps.
   */
  boundaries?: ReadonlySet<string>
  /**
   * Route each complete shared-prerequisite stage (two or more sources that
   * each precede exactly the same two or more targets) through one join/split
   * point (DAGs).
   */
  junctions?: boolean
  /**
   * Where cards were in a reference layout. ELK then keeps that order within
   * each layer (semi-interactive crossing minimization) and still minimizes
   * the crossings of long edges. Transitions pass their union layout, so cards
   * keep their relative places from step to step.
   */
  hints?: ReadonlyMap<string, Point>
  /**
   * Space between layers. Defaults to `layerGap`, grown (once) to fit the
   * widest bundle of parallel runs that share one gap at full radius; pass a
   * layout's own `layerGap` to lay another out with the same spacing, as a
   * transition does for every layout it moves between.
   */
  layerGap?: number
  /**
   * How to place the cards (see `GraphLayout.alignment`); chosen when absent. A transition passes its union's, so
   * every step places its cards alike, in one ELK run.
   */
  alignment?: GraphAlignment
}

/**
 * How a layout placed its cards: one of the four Brandes–Köpf alignments (`LEFTUP`, `RIGHTUP`, `LEFTDOWN`,
 * `RIGHTDOWN`), with one port in the middle of each card face, or their `BALANCED` average with ELK's own ports.
 */
export type GraphAlignment = Alignment

/** A graph node to lay out: a card of its kind's height (see `cardHeight`) and `cardWidth`, unless it gives its own. */
export interface LayoutNode {
  /** Unique among the nodes: the key of its place in `GraphLayout.points` and `sizes`. */
  id: string
  /** The entity's kind, which sets the card's height (`cardHeight`) and whether it may become a boundary. */
  kind: string
  /** The card's height, when its text makes it taller than its kind's (see `diffCardText`). */
  height?: number | undefined
  /** The card's width, when it is sized to its text (see `graphCardWidth`). */
  width?: number | undefined
}

/** The width of a card laid out without one of its own; `GraphCanvas` sizes cards to their text (`graphCardWidth`). */
export const cardWidth = 200
/** The band at the bottom of every card in a comparison reserved for its change status, so status never resizes a card. */
export const cardFooterHeight = 18
/**
 * A card's height: its text (one line for a file, a kind line and a label otherwise) and, unless `footer` is false
 * (one revision, which has no change status), the status footer under it.
 */
export function cardHeight(kind: string, footer = true): number {
  return (kind === 'file' ? 36 : 56) + (footer ? cardFooterHeight : 0)
}
