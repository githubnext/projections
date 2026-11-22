import type {
  ComparisonDocument,
  Definition,
  Diagnostic,
  Extraction,
  ExtractionDocument,
  PresentationSettings,
} from '@githubnext/projections-schemas'
import type {RendererManifest} from '@githubnext/projections-host'

// The runner API responses with schemas (`@githubnext/projections-schemas/runner`), whose decoders check them.
export type {
  ExploreCandidate,
  ExploreCandidates,
  OnboardingFile,
  OnboardingWrite,
  Sweep,
  SweepCell,
  SweepChange,
  SweepProjection,
  Pair as InspectorPair,
  Pairs as InspectorPairs,
  DefinitionSave as InspectorDefinitionSave,
  WorkspaceChanges as InspectorWorkspaceChanges,
} from '@githubnext/projections-schemas/runner'

/** Transport API for the local-only Inspector; browser requests can never grant execution trust. */
/**
 * What using a definition requires, as `projections list` reports it:
 * `requiresTrust` when its extractor runs repository code, and
 * `rendererRequiresTrust` when its custom renderer is repository code that
 * differs from the bundle at the revision's merge base with the default branch.
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
  /** Why the bundle isn't served: a bundle the scenarios name is repository code, served only when named or trusted. */
  withheld?: string
}
/** The comparator a fixture scenario compares with: the default one with its options, or a custom comparator file. */
export type FixtureComparator =
  | {default: true; options?: Record<string, unknown>}
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
