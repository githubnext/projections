// The graph canvas's props, controls, pace and entity limit.
import type {Entity, Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {StatusPart} from '../../emphasis.js'
import type {TransitionNode} from '../../graph-transition.js'
import type {KindLineText} from '../../card-text.js'
import type {RendererProps} from '../shell/props.js'
import type {FieldLine} from '../../diff/lines.js'
import {zoomControls} from '../../zoom.js'
import type {CardAccent, CardBadge} from '../../graph-canvas/badges.js'

/**
 * Zoom actions the host draws for a `GraphCanvas` (the kit's `zoomControls`);
 * pass them as `mountRenderer(…, {controls: graphCanvasControls})`. The canvas
 * opens fitted, everything in view, unless that draws text below the kit's
 * `openingFloorPx`: then it opens at that floor on its top row and scrolls.
 * Pinch and Ctrl/⌘-wheel zoom stay in the frame, and a zoomed canvas scrolls
 * to pan.
 */
export const graphCanvasControls = zoomControls
/**
 * The playback pace graph canvases read best at, for `capabilities.pace`:
 * cards travel and fade over most of each step, which needs time to follow.
 */
export const graphCanvasPace = {stepMs: 1800}

/** Most entities a graph lays out; beyond this the canvas asks for a narrower view. */
export const graphEntityLimit = 500

/**
 * Props of `GraphCanvas`: the renderer's own props, passed through, and how the graph lays out and labels its cards.
 * Everything but the renderer props is optional; the defaults draw every entity as a card of its kind.
 */
export interface GraphCanvasProps extends RendererProps {
  /** The layers' direction: `vertical` (the default) runs top to bottom, `horizontal` left to right. */
  orientation?: 'vertical' | 'horizontal'
  /**
   * Group containment-only entities into boundaries: `true` for modules
   * (architecture), or the kinds that may become boundaries.
   */
  compound?: boolean | readonly string[]
  /** Entity rows to present, for example after a search; defaults to every row. */
  visibleIds?: ReadonlySet<string> | undefined
  /**
   * A short code identifier drawn in monospace at the right of a card's kind
   * line, such as a package version. When it differs between revisions, the
   * two crossfade with the card's own step.
   */
  detail?: ((entity: Entity) => string | undefined) | undefined
  /** Cards whose label is human language rather than an identifier (for example a summary card), drawn in sans. */
  prose?: ((entity: Entity) => boolean) | undefined
  /**
   * Presentation-only cards and links that stand for no extracted entity or
   * relationship, such as a summary of collapsed items: drawn and activated
   * (through `onSelect`) like the others, but carrying no selection ID
   * (`data-graph-synthetic` instead of `data-entity-id`), so hosts never see them.
   */
  synthetic?: ((id: string) => boolean) | undefined
  /**
   * What `model` is a view of, when a renderer derives it (for example with
   * groups expanded or collapsed): while a new model of the same document is
   * laid out, the current layout stays on screen, and keyboard focus with it,
   * instead of the loading state.
   */
  source?: unknown
  /**
   * A synthetic card's accessible name and, for one that opens or closes a
   * group of cards, whether that group is open (`aria-expanded`). Defaults to
   * `Show` and the card's label.
   */
  syntheticAction?: ((entity: Entity) => {label: string; expanded?: boolean} | undefined) | undefined
  /**
   * A card's kind line (and a boundary's heading) instead of the entity's
   * kind, for example a resource type. `identifier` draws it in the monospace
   * font; a long one keeps its end, the most specific part. `note` follows it
   * in the text font (`aws_db_instance · Replace`).
   */
  kindLine?: ((entity: Entity) => KindLineText | undefined) | undefined
  /** The domain's wording of a row's change in its status footer and accessible name (see `StatusPart`). */
  describeStatus?: ((node: TransitionNode) => StatusPart[] | undefined) | undefined
  /**
   * Entity rows to bring forward, for example what depends on the selection:
   * other cards and relationships recede. `label` says what is highlighted,
   * for people who don't see the graph.
   */
  focus?: {ids: ReadonlySet<string>; label: string} | undefined
  /**
   * Diff mode's field changes of a modified entity, drawn inline on its card
   * (the name, then the old value struck through and the new one), which
   * grows to hold them: at most three, then a count of the rest. Values are
   * shown verbatim and whole (see `diffCardText`).
   */
  changedFields?: ((row: EntityChange<Entity>) => readonly FieldLine[] | undefined) | undefined
  /**
   * Short facts drawn as badges in rows under a card's text, such as a data field's values: the card grows a row for
   * each row of badges either revision needs. They crossfade with the card's own step when they change; in the diff,
   * badges a modified card gained or lost are marked added or removed. A badge is code, in monospace (`network`), or
   * `{text, prose: true}` for human words, in sans (`property tests`). Pass a stable function: a new one lays out again.
   */
  badges?: ((entity: Entity) => readonly CardBadge[] | undefined) | undefined
  /**
   * A few words under a card's label, such as what the entity is for: human text in sans, wrapped to the card on at
   * most `subtitleMetrics.lines` lines and ending in an ellipsis when longer (the tooltip has it whole). The card grows
   * a line for each line either revision needs; a changed one crossfades with the card's own step. Pass a stable
   * function: a new one lays out again.
   */
  subtitle?: ((entity: Entity) => string | undefined) | undefined
  /**
   * A small icon before a card's kind line, and before a boundary's heading, that says at a glance what the entity
   * is: a name in `cardIconNames` (Lucide's, such as `terminal` or `database`), drawn 14 units square in the muted
   * text color. Any other name draws nothing, so a renderer may pass a data field's value as it is; the kind line
   * keeps room for the icon wherever either revision has one. A changed icon crossfades with the card's own step;
   * the diff shows the After revision's. Pass a stable function: a new one lays out again.
   */
  icon?: ((entity: Entity) => string | undefined) | undefined
  /**
   * A card's weight, such as its lines of code: a gauge along the card's top edge from its leading corner, as long as
   * the square root of its share of the heaviest row's weight (see `weightShares`), in its accent's paint, so the heavy
   * parts of a graph stand out while every card keeps the graph's one width and the cards line up in columns. Rows
   * without a positive weight have no gauge. Pass a stable function.
   */
  weight?: ((entity: Entity) => number | undefined) | undefined
  /** A card's accent: a band in its paint along the card's leading edge, its meaning in the card's accessible name. */
  accent?: ((entity: Entity) => CardAccent | undefined) | undefined
  /** A relationship's paint while its change isn't emphasized, such as a color per relationship kind. */
  relationshipColor?: ((relationship: Relationship) => string | undefined) | undefined
  /**
   * What the next view of the same document (`source`) keeps in place, when the person changed the view by activating
   * a card, such as a summary card that expands its group: see `GraphAnchor`. Pass a new object for each activation.
   */
  anchor?: GraphAnchor | undefined
}

/**
 * The card a person activated to change the view, and what stands in its place in the next view: the same card, or
 * the one that replaces it (the boundary a summary card expands into). When the next view is laid out, the canvas keeps
 * the zoom, keeps `to`'s top left corner where `from`'s was on screen, and moves the cards from where they were to
 * where they go while the cards the view reveals fade in.
 */
export interface GraphAnchor {
  /** The activated card's ID, in the view drawn when it was activated. */
  from: string
  /** The ID of what stands in its place in the next view. */
  to: string
}
