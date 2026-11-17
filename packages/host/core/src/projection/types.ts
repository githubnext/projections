import type {
  AnchorRect,
  AnnotationMark,
  ColorMode,
  ControlValue,
  FilterPayload,
  RendererLegend,
  InitPayload,
  ProgressPayload,
  RendererControl,
  RendererEnvironment,
  RendererFocus,
  RendererTheme,
  ScrollPosition,
} from '@githubnext/projections-renderer-sdk/protocol'
import type {ViewScope} from '@githubnext/projections-renderer-sdk/presentation'
import type {PresentationSettings} from '@githubnext/projections-schemas'
import type {RendererFrame} from '../frame.js'
import type {ComparisonMode, Side} from '../modes.js'
import type {PaneState} from '../pane.js'
import type {RendererDocuments, RendererEntry} from '../registry.js'
import type {Row, Variation, ViewSubject} from '../model.js'
import type {Holds} from '../playback.js'
import type {ProjectionSelection, ProjectionTarget, TargetAnnotation, TargetResolution} from '../targets/target.js'
import type {SummaryFigure, SummaryFilter} from '../summary.js'
import type {ScopeCounts, ScopeHidden} from './filtering.js'

/**
 * Change highlighting: `animated` fades emphasis in and out with progress
 * (none at either endpoint), `on` keeps it at full strength, `off` hides it.
 * Side by side and swipe show both endpoints, so `animated` and `on` both
 * highlight there.
 */
export type Highlighting = 'animated' | 'on' | 'off'

/** Every `Highlighting` setting, the default first, in the order a host offers them. */
export const highlightingModes: readonly Highlighting[] = ['animated', 'on', 'off']

/**
 * Defaults a projection definition sets for host and renderer settings
 * (`definition.presentation`). Viewers can still change them.
 */
export type PresentationDefaults = PresentationSettings

/** One piece of state an embedder may control: pass the value and handle changes, or let the core own it. */
type Controllable<Name extends string, T> = {[K in Name]?: T} & {[K in `initial${Capitalize<Name>}`]?: T} & {
  [K in `on${Capitalize<Name>}Change`]?: (value: T) => void
}

/**
 * The options of `useProjection`: the subject and the renderers that can present it, then the projection's
 * settings, each controllable (a value with its `on…Change` callback) or owned by the core (from an optional
 * `initial…` value).
 */
export type ProjectionOptions = {
  subject: ViewSubject
  /** `renderer` is the definition's renderer name (or custom bundle path); it defaults to the renderer bundle's name. */
  projection: {id: string; title: string; renderer?: string}
  /**
   * Renderer bundles that can present this projection, the default first.
   * The person may choose among them (`setRenderer`).
   */
  renderers?: readonly RendererEntry[]
  /**
   * Built-in renderer documents for renderers that nest them (`document-request`): usually `builtinRendererDocuments`
   * of the host's whole catalog, not only `renderers`. Omitted, such requests are refused.
   */
  rendererDocuments?: RendererDocuments | undefined
  /** Shown whenever the requested renderer is unavailable or was substituted. */
  rendererNotice?: string | undefined
  /** Informational notices, for example how the compared revisions define the projection differently. */
  notices?: readonly string[]
  /** Defaults from the projection definition. */
  presentation?: PresentationDefaults | undefined
  colorMode?: ColorMode | 'auto'
  /** Theme token overrides, keyed by token name, for example from a design system. */
  themeTokens?: {[name: string]: string}
  /** Called when a renderer or the host asks to open a source location. The embedder decides whether to navigate. */
  onOpen?: (path: string, line?: number) => void
  /** Called when an action control is activated, after it is sent to the renderer. */
  onAction?: (id: string) => void
  /** Called whenever the selection changes, with the selected row and the targets it presents (`null` when nothing is selected). */
  onSelectionChange?: (selection: ProjectionSelection | null) => void
  /**
   * Markers on targets, for example how many comments each has. Renderers
   * with the `annotations` capability and the host's views draw one marker
   * per presented row; targets the subject doesn't present are listed in
   * `unplacedAnnotations`.
   */
  annotations?: readonly TargetAnnotation[]
  /** Called when a person activates an item's annotation marker, in a renderer or a host view. The item is selected first. */
  onAnnotationActivate?: (activation: AnnotationActivation) => void
  /**
   * Playback duration at 1× speed, in milliseconds. Defaults to the
   * definition's `presentation.durationMs`, else scales with the step count
   * (`defaultDuration`).
   */
  durationMs?: number | undefined
  /**
   * Where renderers open their view (`RendererFocus`): a comparison's changes, everything, or one item, and whether
   * to fit it whatever its text size (for images). Sent with the document; omitted, each renderer opens as it
   * chooses.
   */
  focus?: RendererFocus | undefined
  /**
   * The playback direction, for an embedder that moves `position` or `progress` itself (for example to record
   * playback): renderers draw the motion of that direction and report its step ends. Omitted, the core's own, which
   * follows playback and seeking.
   */
  direction?: 1 | -1 | undefined
} &
  /**
   * The transition slider's position, 0 (before) to 1 (after): what the
   * slider shows, playback advances at a constant rate and `seek` sets. With
   * `holds: 'timeline'` it maps to the presentation `progress` through a
   * timeline with a plateau at each step end; with `holds: 'pause'` the two
   * are equal.
   */
  Controllable<'position', number> &
  /**
   * The presentation progress renderers show, 0 (before) to 1 (after). An
   * embedder may control it instead of `position`: the core shows the
   * matching slider position (a step end in the middle of its hold) and
   * requests changes through `onProgressChange`.
   */
  Controllable<'progress', number> &
  /** Where playback holds at step ends (see `Holds`); default `timeline`. */
  Controllable<'holds', Holds> &
  Controllable<'playing', boolean> &
  /**
   * Whether animated playback loops: at each endpoint it holds and reverses
   * (Base → Head → Base …) instead of stopping. On by default; reduced motion
   * never loops.
   */
  Controllable<'loop', boolean> &
  Controllable<'speed', number> &
  /**
   * The comparison mode. A mode the renderer doesn't support (see
   * `availableModes`) falls back to its default (its first supported mode in
   * canonical order: diff, else side by side), and the change
   * is requested through `onModeChange`. Omitted, the renderer's default.
   */
  Controllable<'mode', ComparisonMode> &
  Controllable<'swipePosition', number> &
  Controllable<'highlighting', Highlighting> &
  /**
   * The Changes scope: show a comparison's changes and the unchanged items that give them context (`changeContext`),
   * folding or receding the rest. On by default (the definition's `presentation.changesOnly: false` opts out); off,
   * the scope is everything.
   */
  Controllable<'changesOnly', boolean> &
  /**
   * The Noise scope's varied items: those that varied within tolerance (`variation.within`), unchanged items whose
   * volatile values differ. It wins over `changesOnly`, which turning it on turns off.
   */
  Controllable<'variedOnly', boolean> &
  /**
   * Show only the items whose generated values were regenerated from the same inputs (`variation.regenerated`):
   * unchanged items whose generated text was reworded. With `variedOnly`, the Noise scope; it wins over `changesOnly`.
   */
  Controllable<'regeneratedOnly', boolean> &
  /**
   * The summary bar's filter: show only the items of a figure's kinds, or only those with one change status (`null`,
   * every item). It narrows within the scope: in the Changes scope, those changes and their context.
   */
  Controllable<'summaryFilter', SummaryFilter | null> &
  /** Whether side by side draws a connector between the selected item in both panes. Off unless a host opts in. */
  Controllable<'connector', boolean> &
  Controllable<'search', string> &
  Controllable<'selectedId', string | null> &
  Controllable<'rendererName', string> & {
    /** Controlled values of the renderer's declared controls. */
    controlValues?: {[id: string]: ControlValue}
    /** Called with each requested control value; values are validated against the declaration first. */
    onControlChange?: (id: string, value: ControlValue) => void
  }

/** An annotation marker a person activated. */
export interface AnnotationActivation {
  rowId: string
  /** The targets the row presents. */
  targets: ProjectionTarget[]
  /** The annotations combined in the marker. */
  annotations: TargetAnnotation[]
}

/**
 * Where an item is drawn in a renderer frame, in the host page's viewport
 * coordinates (CSS px, like `getBoundingClientRect`), clipped to what is
 * visible. `side` is the pane: `after` in animated mode.
 */
export interface ProjectionAnchor {
  x: number
  y: number
  width: number
  height: number
  side: Side
}

/** The renderer status across the frames of the current mode. */
export type RendererStatus = 'none' | 'loading' | 'ready' | 'failed'

/** A renderer frame of the stage: `main` in animated and diff, `before` and `after` in side by side and swipe. */
export type PaneKey = 'main' | Side

/** Everything a host UI needs to present a projection, with the actions to change it. */
export interface ProjectionController {
  subject: ViewSubject
  comparing: boolean
  projection: {id: string; title: string; renderer?: string}
  /** Every row (entities, relationships, changes) for table and text views. */
  rows: readonly Row[]
  /** Rows the scope, summary filter and `search` keep: in the Changes scope, the changes they keep and their context. */
  visibleRows: readonly Row[]
  selectedRow: Row | undefined
  /** The renderer notice and informational notices, in display order. */
  notices: string[]
  /** Renderer-reported errors and host stops, latest last, across the current frames. */
  rendererErrors: string[]

  theme: RendererTheme
  colorMode: ColorMode
  /** The theme as `--projections-*` custom properties, for styling host UI with the same tokens. */
  themeStyle: {[property: string]: string}
  reducedMotion: boolean

  renderer: RendererEntry | undefined
  renderers: readonly RendererEntry[]
  /** Built-in renderer documents for renderers that nest them (`ProjectionOptions.rendererDocuments`). */
  rendererDocuments: RendererDocuments | undefined
  rendererStatus: RendererStatus
  panes: Readonly<Record<PaneKey, PaneState>>
  /** The progress the animated frame last acknowledged painting. */
  renderedProgress: number | undefined

  /** The transition slider's position (see `ProjectionOptions.position`). */
  position: number
  /** The presentation progress renderers show at `position`. */
  progress: number
  /** Where playback holds at step ends: on the slider's timeline (default) or by pausing the slider. */
  holds: Holds
  playing: boolean
  direction: 1 | -1
  /** Whether animated playback loops back and forth (see `ProjectionOptions.loop`). */
  loop: boolean
  /** Playback duration at the current speed: `baseDurationMs / speed`. */
  durationMs: number
  /** Playback duration at 1× speed. */
  baseDurationMs: number
  /** Playback speed multiplier (default 1). */
  speed: number
  /** Step boundaries the renderer declared, as presentation progress. */
  stepEnds: readonly number[]
  /** The slider positions of the step ends (the middle of each hold), where step buttons land. */
  stepPositions: readonly number[]
  /**
   * The slider position of the next and previous stop, for `seek`: the
   * steps and both ends (`stepStops`). Undefined only at 1 and 0.
   */
  nextStep: number | undefined
  previousStep: number | undefined
  mode: ComparisonMode
  /** The modes the active renderer supports, in its order (its `comparisonModes`, else the defaults). */
  availableModes: readonly ComparisonMode[]
  /**
   * Whether `availableModes` is the resolved renderer's own declaration. Until it is, a chosen mode is kept as asked
   * (not clamped), so UIs that fall back to a supported mode should wait for this.
   */
  modesKnown: boolean
  swipePosition: number
  highlighting: Highlighting
  /**
   * Which part of a comparison is shown: `changes`, its changes and the items that give them context; `all`; or
   * `noise`, the items that only varied (within tolerance, or regenerated). Always `all` for one extraction.
   */
  scope: ViewScope
  /**
   * How many items each scope holds, as the scope control counts them: the summary bar's count figures' changes
   * (without their context) and totals, else every row's.
   */
  scopeCounts: ScopeCounts
  /**
   * What the Changes scope leaves out, by the summary bar's nouns (`45 tables`, `380 columns`), whatever the scope
   * shown now; empty when every item is a change or gives one context, so Changes and All show the same.
   */
  scopeHidden: readonly ScopeHidden[]
  /** Whether the scope is `changes`. */
  changesOnly: boolean
  /** Whether only the items that varied within tolerance are shown (see `variation`). */
  variedOnly: boolean
  /** Whether only the items whose generated values were regenerated from the same inputs are shown. */
  regeneratedOnly: boolean
  /**
   * How many changes varied: `within`, items whose volatile values (other than generated ones) varied only within
   * tolerance and stay unchanged; `beyond`, modified items with a volatile value beyond it; `regenerated`, unchanged
   * items whose generated values were regenerated from the same inputs. `undefined` when nothing varied.
   */
  variation: Variation | undefined
  /**
   * The summary bar's figures: a figure per kind, counted by the host, in the renderer's words and order when it sent a
   * `summary` (from the after pane in two-pane modes), else the host's words for every kind (`summaryFigures`).
   */
  summary: readonly SummaryFigure[]
  /** The summary bar's filter (see `ProjectionOptions.summaryFilter`), or `null`. */
  summaryFilter: SummaryFilter | null
  /** Whether side by side draws the connector between the selected item's panes. */
  connector: boolean
  search: string
  selectedId: string | null
  /** The selected row with the targets it presents, and the specific target when one was chosen. */
  selection: ProjectionSelection | null
  hoveredId: string | null
  /** Annotation markers per presented row, as renderers receive them. */
  annotationMarks: readonly AnnotationMark[]
  /** The annotations on a presented row. */
  annotationsFor(rowId: string): TargetAnnotation[]
  /** Annotations whose targets this subject doesn't present, for example on an item that was removed or renamed since. */
  unplacedAnnotations: readonly TargetAnnotation[]
  controls: readonly RendererControl[]
  controlValues: {readonly [id: string]: ControlValue}
  /** The renderer's legend (from the after pane in two-pane modes), for the host to draw once. */
  legend: RendererLegend | undefined

  /** Moves the slider to a position (0–1) and pauses. */
  seek(position: number): void
  /** Moves to the slider position that shows a presentation progress (a step end lands mid-hold) and pauses. */
  seekProgress(progress: number): void
  /** Starts playback in a direction (default forward); under reduced motion it shows that endpoint. */
  play(direction?: 1 | -1): void
  pause(): void
  /** Plays in a direction, or pauses when already playing that way. */
  toggle(direction?: 1 | -1): void
  /**
   * The one play button: pauses while playing, else plays in `nextDirection`.
   * Under reduced motion it shows the endpoint in that direction.
   */
  togglePlayback(): void
  /**
   * Where the play button goes: forward from the before end, backward from
   * the after end, and otherwise the last direction of travel (playback,
   * stepping or seeking), initially forward.
   */
  nextDirection: 1 | -1
  stepForward(): void
  stepBack(): void
  /** Sets the playback speed multiplier, between 0.1 and 10. */
  setSpeed(speed: number): void
  setLoop(loop: boolean): void
  setHolds(holds: Holds): void
  setMode(mode: ComparisonMode): void
  setSwipePosition(position: number): void
  setHighlighting(highlighting: Highlighting): void
  /** Chooses the scope (see `scope`); the summary filter and find stay, narrowing within it. */
  setScope(scope: ViewScope): void
  /** Chooses the Changes scope, or every item. */
  setChangesOnly(changesOnly: boolean): void
  /** Shows only the items that varied within tolerance (the Noise scope), or every item again. */
  setVariedOnly(variedOnly: boolean): void
  /** Shows only the items whose generated values were regenerated from the same inputs, or every item again. */
  setRegeneratedOnly(regeneratedOnly: boolean): void
  /** Shows only a summary figure's items (`summaryFilterOf`), or every item again with `null`. */
  setSummaryFilter(filter: SummaryFilter | null): void
  setConnector(connector: boolean): void
  setSearch(query: string): void
  /** Selects a presented row by its selection ID (`null` clears the selection). */
  select(id: string | null): void
  /**
   * Selects the row presenting a target in every pane and view, and reports
   * whether it is present. A target with a `path` the item lacks selects the
   * item and reports `property`. An absent target leaves the selection unchanged.
   */
  selectTarget(target: ProjectionTarget): TargetResolution
  /** Where a target is presented, without selecting it. */
  resolveTarget(target: ProjectionTarget): TargetResolution
  /** Selects a row and reports that its annotation marker was activated. */
  activateAnnotation(rowId: string): void
  /**
   * Where a row (default: the selection) is drawn, in host viewport
   * coordinates, or `null` when it isn't visible or the renderer doesn't
   * report anchors. Prefers `side`, then the selected target's side, then
   * `after`. Use `useProjectionAnchor` to follow it as it moves.
   */
  anchorFor(rowId?: string | null, side?: Side): ProjectionAnchor | null
  hover(id: string | null): void
  setRenderer(name: string): void
  setControl(id: string, value: ControlValue): void
  runAction(id: string): void
  openSource(path: string, line?: number): void

  /** Wiring for `ProjectionStage`. Not a stable API. */
  stage: StageBinding
}

/** @internal Everything `ProjectionStage` needs from the controller. */
export interface StageBinding {
  init: InitPayload
  environment: RendererEnvironment
  progressPayload: ProgressPayload
  endpoints: Record<Side, ProgressPayload>
  /** In diff mode, the one progress to send (highlighting off), else none. */
  diffProgress: ProgressPayload | undefined
  options: {[id: string]: ControlValue}
  action: {id: string; sequence: number} | undefined
  filter: FilterPayload
  anchors: Record<Side, {[id: string]: AnchorRect | null}>
  frames: {current: Record<Side, RendererFrame | null>}
  onPaneState: Record<PaneKey, (state: PaneState) => void>
  onAnchor: Record<Side, (id: string, rect: AnchorRect | null) => void>
  onFrame: Record<Side, (frame: RendererFrame | null) => void>
  onViewport: Record<Side, (position: ScrollPosition) => void>
  /** A renderer selected a row, or a property of an item it presents. */
  onSelect: Record<PaneKey, (id: string | null, path?: string) => void>
  onAnnotation: (id: string) => void
  /** The property path to show as selected in each pane. */
  selectedPath: Record<PaneKey, string | undefined>
  annotations: AnnotationMark[]
}
