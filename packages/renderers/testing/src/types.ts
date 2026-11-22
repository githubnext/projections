import type {DefaultComparatorOptions, Comparison, Extraction} from '@githubnext/projections-schemas'
import type {
  ColorMode,
  ComparisonMode,
  FilterPayload,
  RendererCapabilities,
  RendererControl,
  RendererLegend,
  SummaryItem,
  RendererOptions,
  RendererFocus,
  RendererProjection,
} from '@githubnext/projections-renderer-sdk/protocol'

/** What a stage presents. Comparisons are computed before loading (in the browser, or by a test). */
export type StageSubject =
  | {mode: 'extraction'; extraction: Extraction}
  | {mode: 'comparison'; before: Extraction; after: Extraction; comparison: Comparison}

/** `auto` follows the host default (`diffEmphasis(progress)`), `off` is 0, a number is used as is. */
export type StageHighlighting = number | 'auto' | 'off'

/** What to present on the stage (`StageApi.load`): the renderer by name, the subject and the host state for `init`. */
export interface StageLoad {
  /** Definition renderer name, matched against the served bundles exactly as hosts do. */
  renderer: string
  subject: StageSubject
  /** The projection `init` names; `kinds` is the definition's kind presentation (`presentation.kinds`). */
  projection?: {id: string; title: string; kinds?: NonNullable<RendererProjection['kinds']>}
  /**
   * The comparison mode to announce in `init`. `'diff'` presents one static
   * comparison: the stage sends no `progress`, and `seek` only waits for a
   * paint, unless `highlighting` is `off` or a number, which the stage sends
   * as one `progress` at 1, as a host does when highlighting is turned off.
   * Other modes, or none, drive the frame through progress.
   */
  comparisonMode?: ComparisonMode
  /** Initial progress; defaults to 1. Extractions always present at 1. */
  progress?: number
  direction?: 1 | -1
  highlighting?: StageHighlighting
  selection?: string | null
  /** The host's focus for the opening view, sent in `init` (`RendererFocus`). */
  focus?: RendererFocus
  /**
   * The host's scope, summary filter and find, sent with `init` as a host that has chosen them before the frame is
   * ready does (see `StageApi.filter` for one sent later).
   */
  filter?: FilterPayload
  options?: RendererOptions
  colorMode?: ColorMode
  reducedMotion?: boolean
  locale?: string
  /**
   * Present the frame as one held pane of side by side or swipe (`RendererEnvironment.pane`), as a host does with
   * `progress` 0 for `before` and 1 for `after`.
   */
  pane?: 'before' | 'after'
  /** Frame width in CSS pixels; the page width by default. */
  width?: number
  /**
   * Frame height in CSS pixels: the frame fills it, as a host that sizes its frames does (a tab, a pane). By default
   * the frame follows the height the renderer asks for, as a content-sized host does.
   */
  height?: number
  /**
   * Present in the open frame, with a new `init`, when it shows the same bundle and was itself loaded with `reuse`,
   * rather than in a new frame. Loads that only measure styles use it, so they don't start a renderer process each.
   */
  reuse?: boolean
}

/** How a seek presents its progress: the travel direction and the change highlighting, as `StageLoad` takes them. */
export interface StageSeek {
  direction?: 1 | -1
  highlighting?: StageHighlighting
}

/** A change to the host environment a renderer receives (`RendererEnvironment`); fields left out keep their value. */
export interface StageEnvironment {
  colorMode?: ColorMode
  reducedMotion?: boolean
  locale?: string
  /** One held pane of side by side or swipe (see `StageLoad.pane`); `null` makes the frame a single frame again. */
  pane?: 'before' | 'after' | null
}

/**
 * What the stage has seen of its renderer since it loaded: its status and capabilities, the host state it was last
 * sent, and everything the renderer reported back (paints, selections, steps, legend, summary, controls, opened files,
 * errors and the messages the host rejected).
 */
export interface StageState {
  status: 'waiting' | 'loading' | 'ready' | 'failed'
  /** Bundle the renderer name resolved to. */
  bundle?: string
  capabilities?: RendererCapabilities
  /** The comparison mode announced in `init`, for comparisons loaded with one. */
  comparisonMode?: ComparisonMode
  progress: number
  highlighting: number
  direction: 1 | -1
  /** Last progress the renderer acknowledged painting. */
  rendered?: number
  /** Last selection, from the host or the renderer. */
  selection: string | null
  /** Selections the renderer reported, in order. */
  selections: (string | null)[]
  steps: number[]
  /** The legend the renderer reported for the host to draw, if any (an empty one clears it). */
  legend?: RendererLegend
  /** The words the renderer sent for the host's summary bar, if any (an empty summary clears them). */
  summary?: SummaryItem[]
  /** The controls the renderer declares (in `ready`, then any `controls` message), which a host would draw. */
  controls: RendererControl[]
  height?: number
  opened: {path: string; line?: number}[]
  errors: string[]
  rejected: string[]
  failure?: string
}

/** One measurement the check probe runs inside the renderer document. */
export type ProbeCall =
  | 'samples'
  | 'entities'
  | 'affordances'
  | 'overflow'
  | 'legends'
  | 'selected'
  | 'hovered'
  | 'settle'
  | 'click'
  | 'clickBackground'
  | 'clipping'
  | 'identifiers'
  | 'statusText'
  | 'contentTop'
  | 'opening'
  | 'focus'
  | 'ringNeutral'
  | 'rings'
  | 'ringFocus'
  | 'styles'
  | 'stageSurface'
  | 'stageInsets'
  | 'accents'
  | 'routes'
  | 'viewport'

/** An entity element as painted: its box, effective opacity, paint and visible text. */
export interface EntitySample {
  /** `data-entity-id`, with `#n` for its n-th element after the first. */
  key: string
  id: string
  box: [number, number, number, number]
  opacity: number
  paint: string
  text: string
  /** IDs of entity elements nested inside it (a unit's parts), whose emphasis it may show. */
  parts: string[]
  /**
   * Categorical colours it paints, by category key: parts marked
   * `data-projections-category`. Their fill and background read as
   * `category(key)` in `paint`, so a palette ranked over both revisions isn't
   * change emphasis; `neutral-endpoints` instead checks that each key keeps one
   * colour from Before to After.
   */
  categories: Record<string, string>
}

/** The links a renderer routes between cards (`data-projections-route`): how many, and those that cross cards. */
export interface RouteMeasurement {
  /** How many routed links the renderer marks. */
  count: number
  /** Each link drawn across cards because no route around them exists, with the IDs of the cards it crosses. */
  crossing: {id: string; crosses: string[]}[]
}

/** Identifier elements (`data-projections-identifier`) as painted: how many are visible, and those not in a monospace font. */
export interface IdentifierMeasurement {
  count: number
  /** Each visible identifier whose computed font isn't monospace: the element, its text and its font family. */
  proportional: string[]
}

/** An entity element's full text for assistive technology and readers: its text, `aria-label` and `title`, visible or not. */
export interface EntityText {
  id: string
  text: string
}

/** Where the renderer's content starts: the top of its first entity, canvas or marked content region, and which element it is. */
export interface ContentTop {
  top: number
  element: string
  /** How far below the frame top content may start: the stage padding, the host's `stage-inset` or else 12px. */
  allowance: number
}

/**
 * A zoomable canvas (a scroll container marked `data-zoom`) as it opens: its zoom, whether everything it draws is in
 * its visible area, where its content starts, and the smallest text it draws there.
 */
export interface OpeningCanvas {
  /** The scroll container, described. */
  element: string
  /** Its `data-zoom`: the zoom as a multiple of the fitted scale, 1 when fitted. */
  zoom: number
  /** How many drawn entities it holds. */
  entities: number
  /** The visible area: the container's client box within the frame's viewport, as left, top, right, bottom in CSS px. */
  area: [number, number, number, number]
  /** The drawn entities' bounding box, as left, top, right, bottom in CSS px; null when it draws none. */
  content: [number, number, number, number] | null
  /** Drawn entities not wholly inside the visible area, described with their boxes (at most a few). */
  outside: string[]
  /**
   * Where its content starts: the leftmost entity of its top row, described, with its top-left corner in CSS px, and
   * whether the visible area shows the row's top left (that corner), its top centre (the row's top and the middle of
   * its extent, as a centred layout opens), the drawing's top left (the row's top and the leftmost entity's left side)
   * or none of them; null when it draws none.
   */
  start: {element: string; corner: [number, number]; inView: 'top-left' | 'top-centre' | 'drawing-top-left' | false} | null
  /** Cards (entities that hold no other) its visible area's left or top edge cuts through, described with their boxes (at most a few). */
  cut: string[]
  /**
   * The changed entities it draws (marked `data-change`, as the kit's diff marks them): how many, how many show at
   * least in part, and how many wholly, in its visible area.
   */
  changes: {count: number; inView: number; whole: number}
  /** Whether it can scroll: content larger than its client box. */
  scrolls: boolean
  /** The smallest text drawn in it, in CSS px (font size times the scale it is drawn at); null when it draws none. */
  smallestText: number | null
}

/** The zoomable canvases a renderer opens with, and the frame's viewport, CSS px. */
export interface OpeningMeasurement {
  viewport: {width: number; height: number}
  canvases: OpeningCanvas[]
}

/** The theme's token values as this document resolves them, for the styling checks. */
export interface StyleTokens {
  /** Color tokens by name (without `--projections-`), as `rgba(r, g, b, a)`. */
  colors: Record<string, string>
  /** `font-size-*` and `label-font-size`, in px. */
  fontSizes: number[]
  /** `font-family` and `font-family-mono`, as computed. */
  fontFamilies: string[]
  fontWeights: number[]
  /** `space-*`, in px. */
  spaces: number[]
  /** `radius-*` and `label-radius`, in px. */
  radii: number[]
  /** `border-width*`, in px. */
  borderWidths: number[]
}

/** One visible element of the renderer document, as the styling checks see it. */
export interface StyledElement {
  /** A short description, such as `li.card[data-entity-id="a"]`, and its position in document order. */
  element: string
  index: number
  /** Painted colors by property (`color`, `background-color`, `border-top-color`, `fill`, `box-shadow`, …), normalized. */
  colors: Record<string, string>
  /** Set for elements with text of their own: font size in px, family and weight. */
  font?: {size: number; family: string; weight: number; text: string}
  /** Padding, margin and gap in px, by property; auto-centring margins and percentages are left out. */
  spacing: Record<string, number>
  /** Corner radii in px (or `pill` for fully rounded), and border widths in px, of the sides and corners drawn. */
  radii: Record<string, number | 'pill'>
  borders: Record<string, number>
  /** In a categorical-colour part (`data-projections-category`): its colours follow the category palette. */
  category: boolean
}

/** What the styling checks measure in the renderer document (probe call `styles`): the tokens and visible elements. */
export interface StyleMeasurement {
  tokens: StyleTokens
  elements: StyledElement[]
  /** Subtrees exempted with `data-projections-off-system`: the element and the reason given. */
  exemptions: string[]
}

/** A hue family of the theme: a change color, or the accent. */
export type AccentFamily = 'added' | 'removed' | 'modified' | 'moved' | 'accent'

/** One hued paint of an element (probe call `accents`): the element, its family, the property and its entity, if any. */
export interface AccentPaint {
  element: string
  family: AccentFamily
  property: string
  entity?: string
}

/** A change or accent color drawn inside another's surface (probe call `accents`). */
export interface NestedAccent {
  outer: AccentPaint
  inner: AccentPaint
}

/** The color a renderer paints at one point of its field (probe call `stageSurface`). */
export interface StageSurfaceSample {
  /** Where the point is, in words (`top left`), and its coordinates in CSS px. */
  where: string
  at: string
  /** The painted color, normalized; `transparent` when nothing paints it, `exempt` in a `data-projections-off-system` subtree. */
  color: string
  /** What paints it. */
  element: string
}

/** The renderer's field, sampled just inside the frame's edges, and the stage token (`color-surface-canvas`) as resolved. */
export interface StageSurfaceMeasurement {
  stage: string
  samples: StageSurfaceSample[]
}

/**
 * How evenly the cards, panels and tables on the stage sit in the frame (probe call `stageInsets`): how many outermost
 * ones there are, the first, and the space between their union and the frame's top, sides and the content's end, CSS
 * px, and the host's `stage-inset-top` when it sends one. `fitted` names the zoomable canvas or filling root of a renderer that centres a fitted drawing instead.
 */
export interface StageInsetsMeasurement {
  cards: number
  first?: string
  /** The host's `stage-inset-top`, CSS px: the top the host overlays, which the top inset must at least clear. */
  overlaid?: number
  insets?: {top: number; right: number; bottom: number; left: number}
  fitted?: string
}

/** Whether the renderer document scrolls sideways (probe call `overflow`): its widths in CSS px and what sticks out. */
export interface OverflowMeasurement {
  scrollWidth: number
  clientWidth: number
  /** Elements that extend past the right edge, outermost first. */
  offenders: string[]
}

/** A built-in renderer check, by ID; `checkTitles` and `checkDescriptions` describe each. */
export type CheckId =
  | 'neutral-endpoints'
  | 'step-holds'
  | 'highlight-scope'
  | 'diff-changes'
  | 'diff-neutral'
  | 'diff-clipping'
  | 'affordances'
  | 'rings'
  | 'legend'
  | 'summary'
  | 'phone-overflow'
  | 'selection'
  | 'identifiers'
  | 'stable-layout'
  | 'status-text'
  | 'quiet-endpoints'
  | 'content-top'
  | 'opens-fitted'
  | 'relationships'
  | 'palette'
  | 'stage-surface'
  | 'stage-insets'
  | 'type-scale'
  | 'spacing'
  | 'nested-accents'
  | 'link-routes'

/**
 * One check's outcome (`runChecks`): `skip` when it doesn't apply to the subject or renderer, `fail` when it found a
 * violation or couldn't load or measure, and how long it took in ms.
 */
export interface CheckResult {
  id: CheckId
  title: string
  status: 'pass' | 'fail' | 'skip'
  /** Why it failed or was skipped, or what was checked. */
  details: string[]
  durationMs: number
}

/** The stage the Inspector's fixtures mode exposes as `window.projectionsStage`. */
export interface StageApi {
  load(request: StageLoad): Promise<StageState>
  /** Loads a scenario by key (`<source>/<id>`) or unique ID, with its comparator and presentation. */
  loadScenario(scenario: string, overrides?: Omit<Partial<StageLoad>, 'subject' | 'renderer'>): Promise<StageState>
  seek(progress: number, options?: StageSeek): Promise<StageState>
  select(id: string | null): void
  setOptions(options: RendererOptions): void
  /** Activates a declared action control, as a host's button would. */
  action(id: string): void
  /** Host-side hover, as another pane or the host's table would send it. */
  hover(id: string | null): void
  /** The host's scope, summary filter and find (a `filter` message), as a host sends it once the person, or its own
   * default, chooses them. */
  filter(payload: FilterPayload): void
  setEnvironment(environment: StageEnvironment): void
  /** Resizes the frame; `null` restores the page width. Resolves once the renderer has painted again. */
  setWidth(width: number | null): Promise<void>
  /** Runs a probe measurement inside the renderer document. */
  measure<T = unknown>(call: ProbeCall, args?: unknown): Promise<T>
  state(): StageState
  /** What the stage presents now. */
  subject(): StageSubject
  /** Compares two extractions with the default comparator, in this browser. */
  compare(before: Extraction, after: Extraction, options?: DefaultComparatorOptions): Promise<Comparison>
  /** Scenario keys the Inspector loaded, in sidebar order, with any loading errors. */
  scenarios(): {key: string; id: string; title: string; error?: string}[]
  /** Runs the built-in checks against a scenario in this stage. */
  runChecks(scenario: string, options?: {checks?: CheckId[]}): Promise<CheckResult[]>
}
