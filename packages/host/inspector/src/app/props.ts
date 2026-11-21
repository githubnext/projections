import type {ComponentProps, ComponentType, ReactNode} from 'react'
import type {ComparisonDocument, ExtractionDocument, ProjectionEngine} from '@githubnext/projections-schemas'
import type {ComputedComparison, LoadingStatusProps, RendererEntry, RulesRuntime} from '@githubnext/projections-host'
import type {ProjectionView} from '@githubnext/projections-host/ui'
import type {InspectorApi} from '../client/api.js'
import type {InspectorHandle, InspectorKeptResult, InspectorRunning} from '../control.js'

/** A saved artifact the Inspector presents: an extraction document or a comparison document. */
export type InspectorDocument = ExtractionDocument | ComparisonDocument
/** A comparison the Inspector computed in this browser, with the extractions it compares. */
export type InspectorComparison = ComputedComparison & {before: ExtractionDocument; after: ExtractionDocument}
/**
 * The props of `InspectorApp`: the runner's `api` (without it, only saved artifacts via `loadArtifact`), the engine,
 * the renderers and comparator runtime, and the embedding host's hooks.
 */
export interface InspectorAppProps {
  api?: InspectorApi
  /** The shared engine; comparisons are computed in this browser. */
  engine: ProjectionEngine
  loadArtifact: (json: string) => Promise<InspectorDocument>
  initialDocument?: InspectorDocument
  /** Built-in renderer bundles. Without any, the host's table and text views are shown. */
  renderers?: readonly RendererEntry[]
  /** Checks and runs custom comparators in a sandbox. Without it, projections with a custom comparator cannot be compared. */
  rules?: RulesRuntime
  /** Same-origin prefix of custom renderer bundles, `<prefix><projection>/index.html?ref=<definition revision>`. */
  customRendererBase?: string
  /** Opens a repository file; the embedding host's `openFile` by default. */
  onOpen?: (path: string, line?: number) => void
  /** Receives the handle a host drives this Inspector with (`null` when it unmounts). */
  handleRef?: (handle: InspectorHandle | null) => void
  /**
   * The projection view, for a host UI with its own (for example the VS Code UI's `VscodeProjectionView`); it takes
   * the default UI's `ProjectionView` props, and `running`: what the shown pair's job is doing, `null` while none runs
   * (the VS Code UI's summary bar shows it; the default UI's view ignores it). The default UI's by default.
   */
  projectionView?: ComponentType<ComponentProps<typeof ProjectionView> & {running?: InspectorRunning | null}>
  /** A host UI's loading state (for example the VS Code UI's progress bar), for extracting and computing. The default UI's by default. */
  loadingStatus?: ComponentType<LoadingStatusProps>
  /** The projection and pair to open on instead of the page's `?projection&before&after`, for hosts without navigation. */
  initial?: InspectorOpenedOn
  /**
   * `workbench` (the default) is the Inspector's own shell: title bar, Explorer, Details, panel and status bar. `none`
   * presents only the projection and its notices, for a host whose own UI is the shell (an editor tab per projection).
   * `viewer` is `none` for a page an agent drives and a person watches (`projections view`): failures, trust and
   * comparison errors are said in plain words without paths, commands or diagnostics, which the agent reads instead.
   */
  chrome?: 'workbench' | 'none' | 'viewer'
  /** A line above the projection in a bare view (`chrome` `none` or `viewer`), such as the viewer's header. */
  banner?: ReactNode
  /** In the viewer's page (`chrome` `viewer`), a pane at the start of what is under the banner: its projections pane. */
  aside?: ReactNode
  /**
   * In a bare view, what a one-revision view shows, at its toolbar's start where a comparison's mode switch sits, so
   * the toolbar spans the view in every state (the viewer's shows a commit's short hash there, or nothing).
   */
  toolbarStart?: ReactNode
  /** In a bare view, the stage's utility area (see `ProjectionViewProps.utilityArea`): labels and playback over the stage. */
  utilityArea?: boolean
  /**
   * `auto` (the default) extracts the shown pair again when the working tree or the projection's code changes, and
   * compares again when its comparator does. `compare` extracts nothing on its own but compares again when the
   * comparator changes. `manual` leaves results as they are until the host calls the handle's
   * `refresh` (renderer bundles still reload: that is a view, not a result).
   */
  refresh?: 'auto' | 'manual' | 'compare'
  /** Extractions of `initial.projection` a host kept, by ref, presented instead of extracting those refs again. */
  initialResults?: Record<string, InspectorKeptResult>
  /**
   * The revision whose definition applies to both sides at first (`working-tree` by default, the advanced Definition
   * from): a host showing results with the committed definition passes `HEAD`.
   */
  definitionRevision?: string
}

/** The projection and pair to open on, as Explore's sweep opens a change (`?projection=ID&before=REV&after=REV`). */
export interface InspectorOpenedOn {
  projection?: string
  before?: string
  after?: string
}
