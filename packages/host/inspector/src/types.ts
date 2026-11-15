import type {
  ComparisonDocument,
  Definition,
  Diagnostic,
  Extraction,
  ExtractionDocument,
  PresentationSettings,
} from '@githubnext/projections-schemas'
import type {RendererManifest} from '@githubnext/projections-host'

/** Transport API for the local-only Inspector; browser requests can never grant execution trust. */
/**
 * What using a definition requires, as `projections list` reports it:
 * `requiresTrust` when its extractor runs repository code, and
 * `rendererRequiresTrust` when its custom renderer comes from outside the
 * checkout's history and differs from its merge base's.
 */
export interface InspectorPolicy {
  id: string
  requiresTrust: boolean
  rendererRequiresTrust: boolean
  /**
   * For the working tree, the loopback URL of the custom renderer's
   * development server (`npm run dev` in its package), which replaces the
   * built bundle while it runs.
   */
  rendererDevServer?: string
  /**
   * For the working tree, the repository path of the custom renderer
   * package's `scenarios.json`, which `scenarios` presents.
   */
  scenarios?: string
}
/** One of a renderer package's sample scenarios, made extraction documents with the working tree's definition. */
export interface InspectorScenario {
  id: string
  title: string
  description?: string
  /** A comparison's base; absent for a single extraction. */
  before?: ExtractionDocument
  after?: ExtractionDocument
  /** Why the scenario can't be presented; then it has no documents. */
  error?: string
}
/** A projection `projections explore` proposes for this repository, as a trial definition (`GET /api/explore`). */
export interface ExploreCandidate {
  /** The trial definition's ID: the built-in extractor's. */
  id: string
  title: string
  description: string
  extractor: string
  schema: string
  renderer: string
  requiresTrust: boolean
  /** Why it was proposed: the detection pattern that matched, how many files and the first few. */
  basis: {pattern: string; count: number; examples: string[]}
  /** The authored definition that already uses it, if any. */
  adopted: string | null
  definition: Definition
}
/** A change a history sweep tries: a revision against the one before it. */
export interface SweepChange {
  before: string
  after: string
  title: string
  /** The pull request number its message names, if any. */
  number: number | null
  kind: 'merge' | 'commit' | 'pair'
  date: string
}

/** A swept projection: `ready`, or skipped because it needs `--trust`, or failed to prepare. */
export interface SweepProjection {
  projection: string
  status: 'ready' | 'trust' | 'failed'
  requiresTrust?: boolean
  error?: string
}

/** One projection on one change. */
export interface SweepCell {
  projection: string
  before: string
  after: string
  status: 'changed' | 'unchanged' | 'failed'
  changes?: number
  steps?: number
  /** Changes by status (`added`, `removed`, `modified`, …). */
  counts?: Record<string, number>
  error?: string
}

/** A history sweep (`GET /api/sweep`). */
export interface Sweep {
  id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  error: string | null
  changes: SweepChange[]
  projections: SweepProjection[]
  cells: SweepCell[]
}

/** A file Adopt would write: its current content (`null` when absent) and new content. */
export interface OnboardingFile {
  path: string
  before: string | null
  after: string
  created: boolean
  changed: boolean
}

/** An Adopt preview or result (`POST /api/adopt`). */
export interface OnboardingWrite {
  files: OnboardingFile[]
  /** The files' current contents, which writing must still find. */
  digest: string
  written: boolean
  /** Adopt: the adopted IDs and the changes bookmarked for them. */
  adopted?: string[]
  bookmarked?: {id: string; projection: string; change: SweepChange}[]
}

export interface ExploreCandidates {
  /** Whether this Inspector is an explore session (no projections yet), whose candidates every revision defines. */
  session: boolean
  candidates: ExploreCandidate[]
}
/** A Before → After pair the repository suggests (`GET /api/pairs`). */
export interface InspectorPair {
  /** Absent for one revision alone. */
  before?: string
  after: string
  label: string
  source: 'bookmark' | 'merge-base' | 'tag' | 'parent' | 'working-tree' | 'head'
  /** The bookmark's ID, for `source: 'bookmark'`. */
  bookmark?: string
  /** Both sides hold the same files, so the comparison is empty. */
  identical?: boolean
  /** Why it can't be compared here, for example a ref that doesn't exist. */
  error?: string
}
/**
 * What the runner offers as Before → After pairs (`InspectorApi.pairs`): `HEAD` and the default branch, their merge
 * base, the bookmarks (or `bookmarksError` when they couldn't be read), tags and branches, and the suggested pairs.
 * Commits are full hashes; dates are ISO 8601.
 */
export interface InspectorPairs {
  head: {commit: string | null; branch: string | null; dirty: boolean}
  defaultBranch: string | null
  mergeBase: string | null
  bookmarks: {id: string; title: string; projectionId: string; before: string; after: string}[]
  tags: {name: string; commit: string; date: string}[]
  branches: {name: string; commit: string; date: string; current: boolean}[]
  /** Candidates in the order the default is chosen from; ones with identical sides are left out, except bookmarks. */
  suggestions: InspectorPair[]
  /** The pair a projection opens on: the first suggestion with changes, else HEAD (or the working tree) alone. */
  default: InspectorPair
  bookmarksError?: string
}
/** `POST /api/definition`: what saving parts writes (`dryRun`), or wrote. */
export interface InspectorDefinitionSave {
  /** The definition file, relative to the repository. */
  path: string
  before: string
  after: string
  /** The file's digest before saving; pass it back to save exactly this preview. */
  digest: string
  changed: boolean
  written: boolean
}
export interface InspectorScenarioList {
  /** The `scenarios.json` presented, or `null` when the projection's renderer package has none. */
  file: string | null
  scenarios: InspectorScenario[]
}
/**
 * The projection definitions at a revision (`InspectorApi.definitions`), with each one's trust policy and whether the
 * runner was started trusted to run repository code (`executionAuthorized`, its `--trust`).
 */
export interface InspectorDefinitionList {
  definitions: Definition[]
  /** One per definition. Runners that don't report policies are treated as requiring trust for everything. */
  policies?: InspectorPolicy[]
  ref: string
  /**
   * The full commit `ref` names, when it isn't the working tree. A symbolic revision such as `HEAD` moves, so custom
   * renderer URLs, which the server accepts only for a full commit or the working tree, use this.
   */
  commit?: string
  executionAuthorized: boolean
  /** The comparator files (`*.comparator.yaml`) at `ref`, which any projection can try as its comparator. */
  rules?: string[]
  /**
   * For a working tree that defines no projections (`definitions` are then the
   * built-in defaults): how to create one, as `projections init` prints it.
   */
  setup?: {command: string; prompt: string}
  /** Definition files at `ref` that aren't valid, each with its diagnostics; the other definitions still load. */
  invalid?: InspectorInvalidDefinition[]
}
/** A definition file that isn't valid: its projection ID (when it has one), its path and why, where. */
export interface InspectorInvalidDefinition {
  id: string | null
  path: string
  diagnostics: {
    code: string
    message: string
    pointer?: string
    location?: {path: string; line: number; column: number}
  }[]
}
/**
 * What changed in the working tree since a generation: `definitions`,
 * `working-tree` (files extractors examine), or `extractor:<id>`,
 * `renderer:<id>` and `comparator:<id>`. `complete` is false when the runner no
 * longer knows every change since then.
 */
export interface InspectorWorkspaceChanges {
  generation: number
  changes: string[]
  complete: boolean
}
/** A revision the Inspector can extract, the working tree or a commit: the `ref` the runner takes and its `commit`. */
export interface InspectorRevision {
  ref: string
  commit: string
  title: string
  kind?: 'working-tree' | 'commit'
  dirty?: boolean
  /** ISO 8601 commit date. */
  date?: string
}
/** The revisions `InspectorApi.revisions` lists: the working tree first, then `HEAD`'s history, newest first. */
export interface InspectorRevisionList {
  revisions: InspectorRevision[]
}
/** A job to start (`InspectorApi.run`): extract the projection at `before`, or, with `after`, compare the two. */
export interface InspectorRunRequest {
  projectionId: string
  before: string
  after?: string
  /** Extraction only: the revision whose projection definition is applied, so extractions share a definition digest. */
  definitionRevision?: string
  /** Comparison only: apply the base or head revision's definition to both revisions. */
  definition?: 'base' | 'head'
}
/** What the extractor printed while extracting the revision `ref`, for the raw output panel. */
export interface InspectorRunOutput {
  ref: string
  stdout: string
  stderr: string
}
/**
 * An extraction or comparison job: while `running` it has no document yet; once `completed` it has the `extraction` or
 * `comparison` it produced, and a `failed` one says why in `diagnostics`.
 */
export interface InspectorJob {
  id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  outputs: InspectorRunOutput[]
  diagnostics: Diagnostic[]
  extraction?: ExtractionDocument
  comparison?: ComparisonDocument
  /** How the compared revisions define the projection differently (comparison jobs). */
  notices?: string[]
}
/** The comparator a projection definition declares, as the local runner supplies it. */
export type InspectorComparator = {kind: 'default'} | {kind: 'rules'; bytes: Uint8Array; digest: string}
/** The renderer bundles the runner serves (`InspectorApi.renderers`). */
export interface InspectorRendererList {
  /** Built-in renderer bundle names served at `./renderers/<name>/`. */
  renderers: string[]
  /** Absolute same-origin URL prefix of custom renderer bundles: `<prefix><commit|working-tree>/<projection>/index.html`. */
  customRendererBase?: string
}

/** A scenarios file the Inspector's fixtures mode loaded. */
export interface FixtureSource {
  /** `<source>` in scenario keys: the directory name for `scenarios.json`, otherwise the file name. */
  key: string
  path: string
  title?: string
  /** Why the file couldn't be loaded; its scenarios are missing. */
  error?: string
}
/** A renderer bundle served in fixtures mode, from `--renderer` or a scenario's `{"bundle"}`. */
export interface FixtureRenderer {
  key: string
  path: string
  manifest?: RendererManifest
  /**
   * Same-origin URL of its `index.html`, which changes whenever the bundle
   * does; or, with `development`, the loopback URL of the package's running
   * development server, which serves hot updates itself.
   */
  url?: string
  development?: boolean
  error?: string
}
/** The comparator a fixture scenario compares with: the default one with its options, or a custom comparator file. */
export type FixtureComparator =
  | {default: true; options?: {[key: string]: unknown}}
  /** A custom comparator: its comparator file's base64 bytes, its path as written and its options. */
  | {rules: string; id: string; options?: unknown}
/** One scenario of the Inspector's fixtures mode: a subject to present with a renderer, from a scenarios file. */
export interface FixtureScenario {
  /** `<source>/<id>`. */
  key: string
  source: string
  id: string
  title: string
  group: string
  description?: string
  renderer: string | {bundle: string}
  subject: {mode: 'extraction'; extraction: Extraction} | {mode: 'comparison'; before: Extraction; after: Extraction}
  comparator?: FixtureComparator
  presentation?: PresentationSettings
  /** Why the scenario can't be shown, for example a missing extraction file. */
  error?: string
}
/** `GET /api/fixtures`. */
export interface FixtureCatalog {
  /** Increments whenever a watched file changes. */
  generation: number
  sources: FixtureSource[]
  renderers: FixtureRenderer[]
  scenarios: FixtureScenario[]
}
