import type {Entity, Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {Point} from './edge-arrows.js'
import type {GraphLayout} from './layout.js'
import type {Spline} from './splines.js'

/**
 * One entity row's card or boundary in a frame: the row itself, its centre (`x`, `y`) and size in layout units, and
 * how present it is. A row too faint to see at this progress is left out of the frame.
 */
export interface TransitionNode extends EntityChange<Entity>, Point {
  /** The card's width, interpolated between the layouts the frame moves between. */
  width: number
  /** The card's height, interpolated between the layouts the frame moves between. */
  height: number
  /** A compound module boundary rather than a card. */
  group: boolean
  /** How present the card is, 0 to 1: fading in over its arrival window and out over its departure window. */
  opacity: number
  /** Progress through this row's own step, 0 before it starts and 1 after it ends; always 0 for a row no step changes. */
  local: number
}
/**
 * One drawn relationship in a frame: the relationship row, its route and how present it is. A relationship too
 * faint to see, or with an endpoint the frame has no card for, is left out of the frame.
 */
export interface TransitionEdge extends EntityChange<Relationship> {
  /** Entity row ID of the source, as used by `TransitionNode.id`. */
  fromId: string
  /** Entity row ID of the target, as used by `TransitionNode.id`. */
  toId: string
  /** How present the route is, 0 to 1: never more than either endpoint's card, so it fades with what brings it. */
  opacity: number
  /** Unique per drawn edge: a rewired relationship draws its old and new route separately. */
  key: string
  /**
   * Route as a cubic Bézier chain (see `Spline`), on the same clock as its
   * cards: from the source card's face to the target card's face.
   */
  points: Spline
  /** Routed through a shared-prerequisite junction (see `GraphLayoutOptions.junctions`). */
  shared: boolean
  /**
   * A `contains` relationship from a compound boundary: drawn by the boundary enclosing its member, so it has no
   * route (`points` is empty) and the canvas draws no link for it.
   */
  containment: boolean
  /** Progress through this relationship's own step, as `TransitionNode.local`. */
  local: number
  /**
   * Which revision's route of a rewired relationship this is, in the diff
   * frame: its old route (removed) or its new one (added). Absent otherwise.
   */
  part?: 'before' | 'after'
}
/** What a graph transition draws at one progress (see `GraphTransition`), in layout units. */
export interface GraphFrame {
  /** Cards and boundaries visible at this progress, in the model's entity order. */
  nodes: TransitionNode[]
  /** Relationships visible at this progress; a rewired one may appear twice, its old and new routes crossfading. */
  edges: TransitionEdge[]
  /** Join/split points of shared-prerequisite stages, when the frame is settled on a layout that has them. */
  junctions: Point[]
  /** The drawing's width, interpolated between the layouts the frame moves between. */
  width: number
  /** The drawing's height, interpolated between the layouts the frame moves between. */
  height: number
}

/** How `createGraphTransition` lays out a comparison. */
export interface GraphTransitionOptions {
  /** The layers' direction: `vertical` (the default) runs top to bottom, `horizontal` left to right. */
  orientation?: 'vertical' | 'horizontal'
  /** Group unambiguous containment-only entities into compound boundaries (see `GraphLayoutOptions.compound`). */
  compound?: boolean | readonly string[]
  /** Entity rows to present; relationships need both endpoints. Defaults to every row. */
  include?: ReadonlySet<string>
  /** Join complete shared-prerequisite stages (DAGs); see `GraphLayoutOptions.junctions`. */
  junctions?: boolean
  /**
   * Lay out only diff mode's union (`GraphTransition.diff`), with cards of
   * the given `heights` (taller for their text, see `diffCardText`); every
   * frame is the diff frame. Leaves the staged layouts out, so it costs one layout.
   */
  diffOnly?: {heights?: ReadonlyMap<string, number>}
  /**
   * Lay out only the revision a held pane shows (`RendererEnvironment.pane`): every frame is that revision, placed in
   * the union's order as the full transition places it, at the cost of two layouts instead of three. Its `layouts` hold
   * that revision's alone, so a pane frames what it draws.
   */
  held?: 'before' | 'after'
  /**
   * Each row's card width, sized to its text in either revision (see `graphCardWidth`), the same in every layout so
   * a card never resizes while scrubbing; `cardWidth` for a row without one.
   */
  widths?: ReadonlyMap<string, number>
  /**
   * Whether cards reserve a status footer (`cardFooterHeight`): a comparison's do; one revision's have no status, so
   * by default an extraction's don't.
   */
  footer?: boolean
  /** How much taller a row's card is than its kind's in every layout, for rows that draw more (badge rows, say). */
  grow?: ReadonlyMap<string, number>
}

/**
 * Staged graph transition driven by the comparison's steps. Each step moves
 * the layout once, between two ELK layouts that keep the model order of the
 * union of both revisions, so survivors keep their relative places; entities
 * enter and leave in their own step's fade window; relationships fade with
 * the endpoint that brings or takes them, a relationship rewired between
 * survivors crossfades while the layout moves, and routes morph by
 * interpolating their spline control points. The layouts are computed once,
 * up front; the transition itself is a pure function of progress.
 */
export interface GraphTransition {
  (progress: number): GraphFrame
  /**
   * Every layout a frame interpolates between, in step order (Before first,
   * After last). Frames stay inside their combined bounds, so framing from
   * them never changes while scrubbing.
   */
  layouts: readonly GraphLayout[]
  /**
   * Diff mode's static frame: the union layout with every entity and
   * relationship of both revisions at full presence, survivors in their After
   * version, and a rewired relationship drawn twice, on its old route and its
   * new one (`TransitionEdge.part`). An extraction's frame is its own layout.
   */
  diff: GraphFrame
}
