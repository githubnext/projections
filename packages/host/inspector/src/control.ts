/**
 * Programmatic control of a mounted Inspector, for hosts that drive it on someone's behalf (an editor command, an
 * agent's canvas action). It does only what the person could do in the page: choose a projection, a Before → After
 * pair and a selection. It grants no trust; extraction still needs the runner's `--trust` for repository code.
 */

import type {ContextItems, ProjectionController} from '@githubnext/projections-host'

/** The Before → After pair (or one revision) a host asks the Inspector to show (`InspectorHandle.setPair`). */
export interface InspectorPairRequest {
  /** The Before revision; omitted to show one revision. */
  before?: string
  /** The After revision, for example `working-tree`, `HEAD` or a branch. */
  after: string
  /** The projection to show it for; the current one by default. */
  projection?: string
  /** The revision whose definition applies to both sides, changed with the pair so it is extracted once. */
  definitionRevision?: string
}

/** What a job for the shown pair is doing: extracting a side of it, or comparing the two. */
export type InspectorRunning = 'extracting' | 'comparing'

/** What the Inspector shows, for a host to report. */
export interface InspectorSummary {
  /** `live` extractions from the runner, or a saved `artifact` or scenario. */
  source: 'live' | 'artifact'
  projection?: {id: string; title: string}
  projections: {id: string; title: string}[]
  pair: {before?: string; after?: string}
  /** The pair's extraction state. `trust` means the projection's extractor needs the runner's `--trust`. */
  status: 'idle' | 'extracting' | 'failed' | 'ok' | 'trust'
  /** What the shown pair's job is doing now: extracting a side, or comparing the two in the page. */
  running?: InspectorRunning
  /** Whether repository code may run (the runner's `--trust`). */
  executionAuthorized: boolean
  /** The comparison of the shown pair, by change status, once it is compared. */
  comparison?: {compared: boolean; rows: number; changes: Record<string, number>}
  /**
   * The presented rows (entities, relationships, changes), changed ones first, at most 100: IDs for `selectEntity`. A
   * change lists its context: the items a person needs to read it, which the Changes scope shows beside it. An identity
   * change (`unchanged` but renamed, split or merged) has its `correspondence`.
   */
  items?: {id: string; label: string; kind: string; status?: string; correspondence?: string; context?: ContextItems}[]
  selection?: {id: string; label: string; kind: string; status?: string}
  error?: string
  /** The notices the view shows, for example that a declared input doesn't exist at one revision. */
  notices?: string[]
  /** The revision whose definition the extractions apply (`working-tree` by default). */
  definitionRevision?: string
  /**
   * The shown pair's extractions, by ref: the runner's job and the result's identity (`provenance.definitionDigest`
   * and `provenance.execution`), for a host that tells when a result is out of date.
   */
  results?: Record<string, InspectorResultIdentity>
  /** The renderer scenario shown instead of the pair (`showScenario`). */
  scenario?: string
  /** The shown pair's sides whose extraction failed, with why: for an agent, never shown in a viewer page. */
  failures?: {ref: string; message: string}[]
}

/**
 * One shown extraction as a host keeps it, to present again without extracting (`MountInspectorOptions.initialResults`):
 * the document, its job and the definition revision it applied.
 */
export interface InspectorKeptResult {
  document: unknown
  job?: string
  definition?: string
}

/** What identifies one extraction a host shows: its job, definition digest and execution (`tree`, `fidelity`). */
export interface InspectorResultIdentity {
  job?: string
  definitionDigest?: string
  execution?: {source?: string; fidelity?: string; tree?: string; strategy?: string; scope?: unknown}
}

/**
 * Drives a mounted Inspector from its embedding host (`MountedInspector.handle`): choose the projection and pair,
 * select, and read what it presents.
 */
export interface InspectorHandle {
  /** Switches to a projection the runner defines; rejects an unknown one. */
  selectProjection: (id: string) => void
  /** Shows a Before → After pair (or one revision). */
  setPair: (pair: InspectorPairRequest) => void
  /** Selects an entity, relationship or change by ID in the presented view (`null` clears it); false when it isn't shown. */
  selectEntity: (id: string | null) => boolean
  summary: () => InspectorSummary
  /**
   * The presented projection's controller (comparison mode, playback, selection, settings), for a host that draws
   * those controls itself, for example as an editor's title actions; `null` until a projection is presented.
   */
  view: () => ProjectionController | null
  /** Extracts the shown pair again and compares it, as a host's Refresh does when it refreshes by hand. */
  refresh: () => void
  /** The shown pair's extractions, by ref, for a host to keep and present again later (`initialResults`). */
  results: () => Record<string, InspectorKeptResult>
  /**
   * Applies the projection's definition from a revision to both sides (`working-tree`: your edits; `HEAD`: the
   * committed version), as `--definition-revision` does, extracting the shown pair with it.
   */
  setDefinitionRevision: (ref: string) => void
  /** Cancels the extractions queued and running, as the Inspector's own Cancel does. */
  cancel: () => void
  /**
   * Shows one of the projection's renderer scenarios (its `scenarios.json`) instead of the pair; an unknown one shows the
   * pair. Asked for as the Inspector opens, or just after `selectProjection`, it is shown once that projection and its
   * scenarios have loaded.
   */
  showScenario: (id: string) => void
}
