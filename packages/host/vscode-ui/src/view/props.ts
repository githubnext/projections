import type {ReactNode, Ref} from 'react'
import type {
  AnnotationActivation,
  ComparisonMode,
  ControlValue,
  EvidenceLink,
  Highlighting,
  Holds,
  PresentationDefaults,
  ProjectionController,
  ProjectionSelection,
  RendererEntry,
  TargetAnnotation,
  ViewSubject,
} from '@githubnext/projections-host'
import type {Diagnostic} from '@githubnext/projections-schemas'
import type {PairForm, VscodeProjectionFeatures, ViewKind} from '../blocks.js'
import type {ColorMode} from '../theme/kinds.js'
import type {Running} from '../running.js'

/**
 * The props of `VscodeProjectionView`: the subject to show and the renderers that can draw it, the projection's
 * settings (each controllable through a value and its `on…Change` callback, or initial only), and the host's hooks.
 */
export interface VscodeProjectionViewProps {
  subject: ViewSubject
  /** `renderer` is the definition's renderer name (or custom bundle path); it defaults to the renderer bundle's name. */
  projection: {id: string; title: string; renderer?: string}
  /** The renderer bundle to show. Without one, only the host's table and text views are offered. */
  renderer?: RendererEntry | undefined
  /** Other bundles that can present this projection; the person may switch to them. */
  renderers?: readonly RendererEntry[]
  /** Shown whenever the requested renderer is unavailable or was substituted. */
  rendererNotice?: string | undefined
  /** Informational notices, for example how the compared revisions define the projection differently. */
  notices?: readonly string[]
  /**
   * A host's own panel for the whole view, such as a revision that failed to extract while the other is shown: drawn
   * under the toolbar, above the notices and the stage, in the view's flow.
   */
  banner?: ReactNode
  /** Defaults for host and renderer settings from the projection definition. */
  presentation?: PresentationDefaults | undefined
  beforeLabel?: string
  afterLabel?: string
  /** Overrides the color mode resolved from the VS Code theme. */
  colorMode?: ColorMode | 'auto'
  /** Theme token overrides, applied over the tokens resolved from VS Code's variables. */
  themeTokens?: {[name: string]: string}
  /** Playback duration at 1× speed, in milliseconds. Defaults to the definition's `presentation.durationMs`, else 900 ms per step, between 3 and 20 seconds. */
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
   * selection's details to the embedder (`RawDetails`).
   */
  details?: 'card' | 'none'
  /**
   * Called whenever the selection changes: the selected row ID (`null` when
   * nothing is selected) and the selection with the targets it presents and
   * the chosen target, for example a property.
   */
  onSelectionChange?: (id: string | null, selection: ProjectionSelection | null) => void
  /** Markers on targets, for example a consumer's comments; one marker per presented row. */
  annotations?: readonly TargetAnnotation[]
  /** Called when a person activates a marker, in a renderer or a host view. The item is selected first. */
  onAnnotationActivate?: (activation: AnnotationActivation) => void
  /** Consumer content at the end of the detail card (`.ph-details-slot`). */
  renderDetails?: (selection: ProjectionSelection, projection: ProjectionController) => ReactNode
  /** Receives the controller, for example to call `selectTarget` or `anchorFor`. */
  controllerRef?: Ref<ProjectionController | null>
  /** See `ProjectionViewProps.onProgressChange`. */
  onProgressChange?: (progress: number) => void
  progress?: number
  playing?: boolean
  onPlayingChange?: (playing: boolean) => void
  mode?: ComparisonMode
  initialMode?: ComparisonMode
  onModeChange?: (mode: ComparisonMode) => void
  swipePosition?: number
  onSwipePositionChange?: (position: number) => void
  highlighting?: Highlighting
  onHighlightingChange?: (highlighting: Highlighting) => void
  changesOnly?: boolean
  onChangesOnlyChange?: (changesOnly: boolean) => void
  search?: string
  onSearchChange?: (search: string) => void
  controlValues?: {[id: string]: ControlValue}
  onControlChange?: (id: string, value: ControlValue) => void
  onAction?: (id: string) => void
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
  /** Extra content at the end of the toolbar, for example host actions. */
  actions?: ReactNode
  /**
   * Content at the start of the toolbar; `VscodeComparisonExplorer` puts its `PairPicker` here. A function receives, as
   * the default UI's does, whether the pair picker is the one compare action (`compact`) and the form the toolbar's
   * layout gives it (`PairForm`: `full`, `short` or `merged`; `PairPicker`'s `form`).
   */
  toolbarStart?: ReactNode | ((compact: boolean, form: PairForm) => ReactNode)
  /**
   * A notice floating over the stage, not a tool: a `StageNotice`, such as a VS Code tab's "Out of date · 3 files
   * changed · Refresh". Drawn at the stage's top centre, 12px in (12px below the panes' header bands in side by side
   * and swipe), over every view (renderer, table or text); it takes no layout space, so framing is unchanged, and stays
   * put while the view scrolls under it.
   */
  stageNotice?: ReactNode
  /**
   * The job a host runs for this view (`Running`): its summary bar then shows a spinning `sync` codicon at its end
   * while the view's revisions extract or compare, after a short delay (`runningIndicator`). `null` while none runs:
   * the slot is kept either way, so the figures never move. Omitted, the host reports no jobs and the bar has no slot.
   */
  running?: Running | null | undefined
  /** The comparator that produced the comparison, for About this projection (`.ph-comparator`). */
  comparator?: {id: string; digest: string} | undefined
  /**
   * Fill the container's height (default true; give the container a definite height): the toolbar row and notices
   * keep theirs, the stage takes the rest at full width, and frames fill their pane so renderers scroll inside. The
   * table and text views scroll. Without a definite height the view keeps a usable minimum. `false` sizes frames
   * to their content instead.
   */
  fill?: boolean
  /**
   * Draw the toolbar (default true). `false` shows only the stage, notices and the detail card, for hosts that draw the
   * controls themselves, for example as VS Code `editor/title` actions: drive mode, swap, playback and settings through
   * the controller (`controllerRef`). The Space shortcut on the stage still plays and pauses.
   */
  toolbar?: boolean
  className?: string
  /** Which controls and views to offer (default all). */
  features?: VscodeProjectionFeatures
}
