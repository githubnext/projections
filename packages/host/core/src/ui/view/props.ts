import type {ReactNode, Ref} from 'react'
import type {Diagnostic} from '@githubnext/projections-schemas'
import type {ColorMode, ControlValue} from '@githubnext/projections-renderer-sdk/protocol'
import type {AnnotationActivation, Highlighting, PresentationDefaults, ProjectionController} from '../../projection.js'
import type {Holds} from '../../playback.js'
import type {ProjectionSelection, TargetAnnotation} from '../../targets/target.js'
import type {ComparisonMode} from '../../modes.js'
import type {RendererDocuments, RendererEntry} from '../../registry.js'
import type {ViewSubject} from '../../model.js'
import type {EvidenceLink} from '../../details/evidence.js'
import type {PairForm, ProjectionFeatures, ViewKind} from '../blocks.js'

/**
 * The props of `ProjectionView`: the subject to show and the renderers that can draw it, the projection's settings
 * (each controllable through a value and its `on…Change` callback, or initial only), and the host's hooks.
 */
export interface ProjectionViewProps {
  subject: ViewSubject
  /** `renderer` is the definition's renderer name (or custom bundle path); it defaults to the renderer bundle's name. */
  projection: {id: string; title: string; renderer?: string}
  /** The renderer bundle to show. Without one, only the host's table and text views are offered. */
  renderer?: RendererEntry | undefined
  /** Other bundles that can present this projection; the person may switch to them. */
  renderers?: readonly RendererEntry[]
  /**
   * Built-in renderer documents for renderers that nest them (`document-request`), usually `builtinRendererDocuments`
   * of the host's whole catalog. Omitted, such requests are refused.
   */
  rendererDocuments?: RendererDocuments | undefined
  /** Shown whenever the requested renderer is unavailable or was substituted. */
  rendererNotice?: string | undefined
  /** Informational notices, for example how the compared revisions define the projection differently. */
  notices?: readonly string[]
  /**
   * A host's own panel for the whole view, such as a revision that failed to extract while the other is shown: drawn
   * under the toolbar, above the notices and the stage, in the view's flow.
   */
  banner?: ReactNode
  /**
   * What the embedder's job for the shown pair is doing, `null` while none runs: a renderer pane still loading meanwhile
   * says so ("Extracting…", "Comparing…") rather than that it is loading the renderer.
   */
  running?: 'extracting' | 'comparing' | null
  /** Defaults for host and renderer settings from the projection definition. */
  presentation?: PresentationDefaults | undefined
  beforeLabel?: string
  afterLabel?: string
  colorMode?: ColorMode | 'auto'
  /** Theme token overrides, keyed by token name. */
  themeTokens?: {[name: string]: string}
  /** Playback duration from before to after at 1× speed, in milliseconds; default scales with step count. */
  durationMs?: number
  initialView?: ViewKind
  initialProgress?: number
  diagnostics?: readonly Diagnostic[]
  /**
   * Called when a renderer or the detail card asks to open a source location (in the card, for evidence `evidenceLink`
   * doesn't link). The host decides whether to navigate.
   */
  onOpen?: (path: string, line?: number) => void
  /**
   * Where the detail card links an evidence location on a side, for example a pull request's file diff at the line or
   * the file at a commit; `undefined` for a location leaves it to `onOpen` (or plain text).
   */
  evidenceLink?: EvidenceLink
  /**
   * The selection's detail card, anchored to the selected item over the stage (default `card`). `none` leaves the
   * selection's details to the embedder, for example a docked panel of its own (`RawDetails`).
   */
  details?: 'card' | 'none'
  /**
   * Called whenever the selection changes, including a property path chosen in a renderer or the detail card:
   * the selected row ID (`null` when nothing is selected) and the targets it presents.
   */
  onSelectionChange?: (id: string | null, selection: ProjectionSelection | null) => void
  /**
   * Markers on targets, for example comment counts from an embedding app. The host draws one marker per presented
   * row (in renderers with the `annotations` capability and in the table and text views and the detail card); it shows no
   * annotation content itself.
   */
  annotations?: readonly TargetAnnotation[]
  /** Called when a person activates a row's annotation marker. The row is selected first. */
  onAnnotationActivate?: (activation: AnnotationActivation) => void
  /** Embedder content at the end of the detail card (in a `.ph-details-slot` element). */
  renderDetails?: (selection: ProjectionSelection, projection: ProjectionController) => ReactNode
  /** Receives the view's controller, for example to call `selectTarget` or `anchorFor`; `null` once unmounted. */
  controllerRef?: Ref<ProjectionController | null>
  /**
   * Uncontrolled (no `progress` prop): called whenever the shown progress changes.
   * Controlled: called with each requested progress (seeking, playback, endpoints);
   * the view shows the new value only once the embedder passes it back as `progress`.
   */
  onProgressChange?: (progress: number) => void
  /** Controlled progress, 0 (before) to 1 (after). Omit to let the view own progress. */
  progress?: number
  /** Controlled playback. Omit to let the view own playback. */
  playing?: boolean
  /** Called with each requested playback change, in both modes. Playback stops itself at an endpoint by requesting `false`. */
  onPlayingChange?: (playing: boolean) => void
  /** Controlled comparison mode; see `ComparisonMode`. */
  mode?: ComparisonMode
  /** Uncontrolled initial comparison mode (default `animated`, or the definition's). */
  initialMode?: ComparisonMode
  onModeChange?: (mode: ComparisonMode) => void
  /** Controlled swipe divider position, 0 (all after) to 1 (all before). Default 0.5. */
  swipePosition?: number
  onSwipePositionChange?: (position: number) => void
  /** Uncontrolled initial setting for where playback holds (`timeline` by default; see `Holds`). */
  initialHolds?: Holds
  /** Controlled looping of animated playback (on by default; see `ProjectionOptions.loop`). */
  loop?: boolean
  initialLoop?: boolean
  onLoopChange?: (loop: boolean) => void
  /** Controlled side by side connector between the selected item's panes (off unless a host opts in). */
  connector?: boolean
  initialConnector?: boolean
  onConnectorChange?: (connector: boolean) => void
  /** Controlled change highlighting. */
  highlighting?: Highlighting
  onHighlightingChange?: (highlighting: Highlighting) => void
  /** Controlled "changes only" filter. */
  changesOnly?: boolean
  onChangesOnlyChange?: (changesOnly: boolean) => void
  /** Controlled find query. */
  search?: string
  onSearchChange?: (search: string) => void
  /** Controlled values of the renderer's declared controls, keyed by control ID. */
  controlValues?: {[id: string]: ControlValue}
  /** Called with each requested control value, in both modes. Values are validated against the declaration first. */
  onControlChange?: (id: string, value: ControlValue) => void
  /** Called when an action control is activated, after it is sent to the renderer. */
  onAction?: (id: string) => void
  /** Which controls and views to offer (every feature defaults on). */
  features?: ProjectionFeatures
  /** The comparator that produced the comparison, shown in About this projection (`.ph-comparator`). */
  comparator?: {id: string; digest: string} | undefined
  /**
   * Content at the start of the toolbar; `ComparisonExplorer` puts its `PairPicker` here. A function receives
   * whether the toolbar is condensed (`compact`) and the pair picker's planned `form` (`full`, `short` or `merged`),
   * for example to draw a compact picker.
   */
  toolbarStart?: ReactNode | ((compact: boolean, form: PairForm) => ReactNode)
  /** Extra content at the end of the toolbar row, for example host actions. */
  actions?: ReactNode
  /**
   * Fill the container's height (default true; give the container a definite height): the toolbar row and notices
   * keep theirs, and the stage takes the rest at full width, with frames filling their panes so renderers scroll
   * inside. The table and text views scroll. Without a definite height the view keeps a usable minimum. `false`
   * sizes the view to its content instead.
   */
  fill?: boolean
  /**
   * Puts what would be the toolbar's third bar in a utility area floating over the stage's top edge instead
   * (`ProjectionStageProps.utility`): the revisions' labels in side by side and swipe, as chips on the stage, and the
   * playback slider in animated and beside the table and text views, in an inset bar as wide as it needs. The toolbar
   * keeps one row, and the stage keeps its height; renderers keep clear of what the area covers. Default false.
   */
  utilityArea?: boolean
  className?: string
}
