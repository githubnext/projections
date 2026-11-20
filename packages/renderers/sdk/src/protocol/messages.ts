// The messages between a host and a renderer. Their parsers are `renderer-messages.ts` and `host-messages.ts`.
import type {Comparison, Extraction} from '@githubnext/projections-schemas'
import type {ThemeTokenName} from '../tokens.js'
import type {Envelope, RendererProjection, RendererEnvironment} from './frame.js'
import type {ComparisonMode} from './comparison-modes.js'
import type {RendererSummary} from './summary/items.js'
import type {RendererControl} from './controls/declaration.js'

/**
 * What the host sends a renderer to present. `X` is the extraction type: a renderer that declares what it
 * accepts (`RendererManifest.accepts`) can narrow it, with `AcceptedExtraction`, to the typed extractions
 * the engine guarantees. Every entity and relationship carries `data`, `{}` when the extraction omits it.
 */
export type InitPayload<X extends Extraction = Extraction> = RendererEnvironment & {
  projection: RendererProjection
  /** Where the opening view looks (see `RendererFocus`); absent, the renderer's own choice. */
  focus?: RendererFocus
} & (
    | {mode: 'extraction'; extraction: X}
    | {
        mode: 'comparison'
        before: X
        after: X
        comparison: Comparison
        /**
         * The comparison mode the host presents. `'diff'` means the host sends no
         * `progress`: the renderer draws one static comparison of `before` and
         * `after`. Absent, or any other mode, means progress drives the frame.
         */
        comparisonMode?: ComparisonMode
      }
  )

/**
 * What a host wants a renderer's opening view to show, for example an image of a comparison's changes or of one item.
 * Content that doesn't fit its frame opens on it instead of at the renderer's reading start; the person can still zoom
 * and scroll. A renderer that fits everything anyway may ignore it. Without it, a renderer opens as it chooses: a
 * comparison in diff mode opens on its changes when they don't all fit.
 */
export interface RendererFocus {
  /**
   * `changes`: the comparison's changed items and the relationships between them (in a held pane, those its revision
   * has); `all`: everything. Ignored when `id` names an item.
   */
  on?: 'changes' | 'all'
  /** The selection ID of one item to open on, centred with what it connects to where they fit. */
  id?: string
  /**
   * Fit what is focused into the view even when that draws its smallest text below the opening floor
   * (`openingFloorPx`), which a renderer otherwise keeps to and scrolls the rest: for images that must show it whole.
   */
  fit?: boolean
}

/**
 * Presentation position. `progress` runs from 0 (before) to 1 (after);
 * `highlighting` is the change-emphasis strength the host chose for this
 * position (exactly 0 at both endpoints); `direction` is the playback direction.
 * Extraction mode always uses `{progress: 1, highlighting: 0, direction: 1}`.
 */
export interface ProgressPayload {
  /** Position in the transition, from 0 (`before`) to 1 (`after`); the host validates only that it is finite. */
  progress: number
  /** How strongly to emphasize changes at this position, from 0 (none) to 1 (full); draw it, don't derive it. */
  highlighting: number
  /** `1` while playing or scrubbing forward, `-1` backward, for motion that differs by direction. */
  direction: 1 | -1
}

/**
 * The renderer's settings as the host last sent them in `options`: each declared control's value under its `id`
 * (read them with `controlValues`, which falls back to defaults), plus any options the host sets itself. Each
 * `options` message replaces the whole object.
 */
export interface RendererOptions {
  /** Whether to draw relationships, for renderers that declare `toggleableRelationships`; absent means draw them. */
  showRelationships?: boolean
  [key: string]: unknown
}

/**
 * A marker the host asks a renderer to draw on an item, for example a count
 * of comments or findings. `id` is the item's selection ID.
 */
export interface AnnotationMark {
  /** The annotated item's selection ID, never empty. */
  id: string
  /** A number to show, for example how many comments. */
  count?: number
  /** Short accessible description, for example `2 comments`. */
  label?: string
  /** `attention` for something unresolved, `done` for something resolved. */
  tone?: AnnotationTone
}
/**
 * Marker tones, deliberately unlike change colors: `neutral`, `attention`
 * (something to act on, in the accent color), `done` (resolved, muted) and
 * `subtle` (for example outdated, with a dashed outline).
 */
export const annotationTones = ['neutral', 'attention', 'done', 'subtle'] as const
/** One of `annotationTones`: how a marker reads, independent of the item's change status. */
export type AnnotationTone = (typeof annotationTones)[number]

/**
 * How a legend item's swatch is drawn: a `square` or `circle` of color, or a
 * short `line`, `dashed` line or `dotted` line. `dotted` came later: a host
 * that can't draw it draws it `dashed`.
 */
export const legendShapes = ['square', 'circle', 'line', 'dashed', 'dotted'] as const
/** One of `legendShapes`: a filled `square` or `circle`, or a solid, `dashed` or `dotted` stroke for relationships. */
export type LegendShape = (typeof legendShapes)[number]

/**
 * One entry of a renderer's legend, which the host draws once beside the
 * renderer frames (not inside each pane), with its own design system. The
 * swatch is a theme token (`token`, preferred, so it follows the host theme)
 * or a CSS color (`color`: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(…)` or
 * `hsl(…)`), never both. An item with neither is a plain label, for example
 * an entity kind, and has no `shape`.
 */
export interface LegendItem {
  /** What the swatch means, 1 to `rendererLimits.legendLabel` characters. */
  label: string
  /** The swatch as a theme token, which follows the host's theme. */
  token?: ThemeTokenName
  /** The swatch as a fixed CSS color, for colors no token names. */
  color?: string
  /** Default `square`. */
  shape?: LegendShape
}

/** A renderer's legend: an optional title and its items; no items clears it. */
export interface RendererLegend {
  /** A heading for the legend, 1 to `rendererLimits.legendLabel` characters. */
  title?: string
  /** The entries in display order, at most `rendererLimits.legendItems`. */
  items: LegendItem[]
}

/**
 * Every message a host sends a renderer, without its envelope (`HostEnvelope`), as `parseHostMessage` accepts it.
 * `connectRenderer` hands each to the matching `RendererHandlers` member; a renderer receives `init` first and again
 * whenever the document changes, and every other message may arrive at any time after it.
 */
export type HostMessage =
  | ({type: 'init'} & InitPayload)
  | ({type: 'progress'} & ProgressPayload)
  /** The selected item, and optionally a property of it (`path`, an RFC 6901 pointer into the item). */
  | {type: 'select'; id: string | null; path?: string}
  /**
   * Markers to draw on items, replacing any earlier ones. Sent only to
   * renderers with the `annotations` capability.
   */
  | {type: 'annotations'; items: AnnotationMark[]}
  /** The renderer's settings, replacing earlier ones: control values by `id` (see `RendererOptions`). */
  | {type: 'options'; options: RendererOptions}
  /** The frame's size in CSS px, sent on load and whenever it changes. */
  | {type: 'viewport'; width: number; height: number}
  /** A new theme, motion preference, locale, pane or sizing, replacing the one `init` carried. */
  | ({type: 'environment'} & RendererEnvironment)
  /** The entity the person is pointing at in any pane, or `null`. Sent only to renderers with the `hover` capability. */
  | {type: 'hover'; id: string | null}
  /**
   * Scroll a scroll container to `x`, `y` (CSS px), mirroring another pane.
   * `key` names the container (see `ScrollPosition`); without it, the
   * document. Sent only to renderers with the `scrollSync` capability.
   */
  | ({type: 'scroll'} & ScrollPosition)
  /** The person activated an `action` control. */
  | {type: 'action'; id: string}
  /**
   * The host's find and "changes only" settings. `ids` lists the selection IDs
   * that match (`null` when nothing is filtered); renderers with the `filter`
   * capability de-emphasize or hide the rest.
   */
  | ({type: 'filter'} & FilterPayload)
  /**
   * A built-in renderer's document, answering the renderer's `document-request` for it: `html` as this host runs it,
   * or the `error` that says why the host won't supply it (an unknown or custom renderer, or a host that supplies none).
   */
  | ({type: 'document'} & RendererDocument)

/**
 * A built-in renderer's document as the host supplies it (`document`): the bundle's `index.html` text, exactly as the
 * host would load it into its own frame, or why the host can't supply it. Exactly one of `html` and `error`.
 */
export type RendererDocument = {renderer: string} & ({html: string; error?: never} | {error: string; html?: never})

/**
 * What a renderer supports, declared once in `ready` (`ConnectOptions.capabilities`). Hosts send the optional messages
 * (`hover`, `scroll`, `filter`, `annotations`) only to renderers that declare them, and the renderer checks hold each
 * declared capability to its contract. Optional flags default to off, except `drawsRelationships`.
 */
export interface RendererCapabilities {
  /** Whether the renderer visibly emphasizes changes using `highlighting`. */
  changeHighlighting: 'supported' | 'none'
  /** Whether the renderer honors `options.showRelationships`. */
  toggleableRelationships?: boolean
  /**
   * Whether the renderer draws relationships as elements marked with the
   * relationship's ID in `data-entity-id`. Defaults to true; declare `false`
   * only when it deliberately draws none, or shows them only as structure
   * (nesting, order), so the renderer checks don't expect them.
   */
  drawsRelationships?: boolean
  /** Whether the renderer presents its own timeline; the host still owns progress. */
  ownTimeline?: boolean
  /** Whether the renderer reports and shows hover (`hover` in both directions). */
  hover?: boolean
  /** Whether the renderer reports where the selected and hovered entities are (`anchor`). */
  anchors?: boolean
  /** Whether the renderer reports scrolling (`viewport`) and follows `scroll`. */
  scrollSync?: boolean
  /** Whether the renderer honors the host's `filter`. */
  filter?: boolean
  /**
   * Whether the renderer reads the comparison's change `context` (`Change.context`). Hosts strip `context` from the
   * comparison a renderer without it is sent, so a renderer that checks comparisons against an older schema, which
   * closes `Change`, keeps working. Kit renderers declare it.
   */
  context?: boolean
  /** Whether the renderer draws the host's `annotations` and reports `annotation` when one is activated. */
  annotations?: boolean
  /** Whether the renderer draws item properties and may report them as `select` with a `path`. */
  properties?: boolean
  /**
   * Comparison modes the renderer supports. Hosts show them in canonical
   * order and open in the first: diff when it is supported, else side by
   * side (`defaultComparisonMode`); the declared order doesn't matter. Without
   * it, `defaultComparisonModes`. The same list belongs
   * in the bundle's `renderer.json`, so a host can offer the right modes
   * before the frame loads.
   */
  comparisonModes?: ComparisonMode[]
  /**
   * The pace the renderer's motion reads best at: `stepMs`, how long one
   * comparison step should take during playback (an integer from
   * `rendererLimits.paceStepMs.min` to `.max`). Hosts that size playback by the
   * step count use it in place of their default; the person's own speed
   * setting still applies on top, and the host still owns progress.
   */
  pace?: RendererPace
  /**
   * Controls the host draws for the renderer, in display order. Values arrive
   * in `options` under each control's `id`; actions arrive as `action`. A
   * renderer may replace them later with a `controls` message.
   */
  controls?: RendererControl[]
}

/** The playback pace a renderer reads best at (`RendererCapabilities.pace`). */
export interface RendererPace {
  /** Milliseconds per comparison step: an integer within `rendererLimits.paceStepMs`, else `ready` is invalid. */
  stepMs: number
}

/**
 * The host's find and "changes only" settings, as `filter` carries them. Renderers that declare `filter` de-emphasize
 * or hide the items `ids` leaves out; `query` and `changesOnly` are for describing the state, not for matching again.
 */
export interface FilterPayload {
  /** The find query as typed, or an empty string. */
  query: string
  /** Whether the person asked to see only changed items; `ids` already reflects it. */
  changesOnly: boolean
  /** Matching selection IDs, or `null` when every item is shown or more than `rendererLimits.filterIds` match. */
  ids: string[] | null
}

/** A rectangle in the renderer document's viewport, in CSS px. */
export interface AnchorRect {
  /** Left edge, relative to the viewport's left; within ±`rendererLimits.maxCoordinate`. */
  x: number
  /** Top edge, relative to the viewport's top; within ±`rendererLimits.maxCoordinate`. */
  y: number
  /** Width, never negative. */
  width: number
  /** Height, never negative. */
  height: number
}

/**
 * A scroll position in CSS px. `key` identifies the scroll container so that
 * two panes of the same renderer can mirror each other: the value of its
 * `data-projections-scroll` attribute, or a structural path. Omitted for the
 * document itself.
 */
export interface ScrollPosition {
  /** Horizontal scroll offset, never negative. */
  x: number
  /** Vertical scroll offset, never negative. */
  y: number
  /** The scroll container: 1 to 256 letters, digits, spaces or `_.:>-`. Absent for the document. */
  key?: string
}

/**
 * Every message a renderer sends its host, without its envelope (`RendererEnvelope`), as `parseRendererMessage`
 * accepts it. Renderers post them through `RendererClient`, which clamps and validates them; the host drops any that
 * fail validation or exceed `rendererLimits`.
 */
export type RendererMessage =
  /** The renderer is listening and supports `capabilities`; the host replies with `init`. */
  | {type: 'ready'; capabilities: RendererCapabilities}
  /** The frame for `progress` (0 to 1) has been painted. */
  | {type: 'rendered'; progress: number}
  /** The person selected an item, or a property of it (`path`), or cleared the selection (`null`). */
  | {type: 'select'; id: string | null; path?: string}
  /** The frame height the renderer wants, in CSS px; the host clamps it to `rendererLimits.minHeight`–`maxHeight`. */
  | {type: 'height'; px: number}
  /**
   * The shape of the content the renderer fits to its stage, as width / height of its framing (the union of every
   * frame of the transition, so it doesn't change while scrubbing). A host uses it to arrange held panes (side by
   * side or stacked) for the larger fitted scale. Optional; renderers whose content adapts to any stage omit it.
   */
  | {type: 'aspect'; ratio: number}
  /**
   * Progress values where the host may hold during playback, and optionally how many step slots the presentation
   * spans (`slots`, see `timelineSlots`): more than the steps when some take extra time, such as reading what a step
   * removes, so the host's default pace scales with it rather than speeding up the motion.
   */
  | {type: 'steps'; ends: number[]; slots?: number}
  /** Asks the host to open a repository file, optionally at a 1-based `line`; the host decides whether to. */
  | {type: 'open'; path: string; line?: number}
  /** A rendering failure, which the host shows beside its own views. */
  | {type: 'error'; message: string}
  /** The entity under the pointer, or `null` when the pointer leaves entities. */
  | {type: 'hover'; id: string | null}
  /**
   * Where an entity is drawn, for the host's connector between panes. Sent for
   * the selected and hovered entities whenever they move (scroll, resize,
   * layout); `rect` is `null` when the entity isn't visible.
   */
  | {type: 'anchor'; id: string; rect: AnchorRect | null}
  /** The person scrolled a scroll container. */
  | ({type: 'viewport'} & ScrollPosition)
  /** Replaces the controls declared in `ready`, for example after a new document. */
  | {type: 'controls'; controls: RendererControl[]}
  /** The person activated the annotation marker on an item (after selecting it). */
  | {type: 'annotation'; id: string}
  /** The renderer's legend, which the host draws once outside the panes; replaces any earlier one. */
  | ({type: 'legend'} & RendererLegend)
  /**
   * The words for the host's summary bar: a figure per extraction kind, in the renderer's vocabulary (see
   * `SummaryItem`); replaces any earlier one. Optional: without it, hosts word the bar from the kind names.
   */
  | ({type: 'summary'} & RendererSummary)
  /**
   * Asks the host for the document of the built-in renderer `renderer` (a name such as `graph`), to run in a frame of
   * the renderer's own, nested in its document. The host answers with `document`. It supplies only built-in renderers,
   * by name from its own registry: never a URL or path, and never a custom renderer.
   */
  | {type: 'document-request'; renderer: string}

/** A host message as posted to the frame: the message with the protocol version and channel. */
export type HostEnvelope = Envelope & HostMessage
/** A renderer message as posted to the host: the message with the protocol version and channel. */
export type RendererEnvelope = Envelope & RendererMessage
