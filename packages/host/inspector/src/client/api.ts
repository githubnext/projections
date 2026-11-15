import type {
  InspectorComparator,
  InspectorDefinitionList,
  InspectorJob,
  InspectorRendererList,
  InspectorRevisionList,
  InspectorRunRequest,
  InspectorWorkspaceChanges,
  InspectorScenarioList,
  InspectorPairs,
  FixtureCatalog,
  ExploreCandidates,
  Sweep,
  OnboardingWrite,
  InspectorDefinitionSave,
} from '../types.js'
import type {ComparisonDocument, ExtractionDocument} from '@githubnext/projections-schemas'

/**
 * The local runner's API as the Inspector calls it (`createInspectorClient` over a transport). Each method validates
 * the runner's response and rejects on a malformed one, an `InspectorRequestError` or an aborted `signal`. Extraction
 * runs as a job: `run` starts it, `job` polls it until it leaves `running`, `cancel` stops it.
 */
export interface InspectorApi {
  definitions(ref: string, signal?: AbortSignal): Promise<InspectorDefinitionList>
  /** Working tree first, then HEAD history, at most `limit` (1-100) entries. */
  revisions(signal?: AbortSignal, limit?: number): Promise<InspectorRevisionList>
  /** The comparator the projection's definition at `ref` (default: the working tree) declares. */
  comparator(projectionId: string, ref?: string, signal?: AbortSignal): Promise<InspectorComparator>
  /** A comparator file at `ref`, by path, to try as a projection's comparator. */
  rulesFile?(path: string, ref?: string, signal?: AbortSignal): Promise<InspectorComparator>
  /** Renderer bundles the server provides, or `null` when the server does not list them. */
  renderers(signal?: AbortSignal): Promise<InspectorRendererList | null>
  run(request: InspectorRunRequest, signal?: AbortSignal): Promise<InspectorJob>
  job(id: string, signal?: AbortSignal): Promise<InspectorJob>
  cancel(id: string, signal?: AbortSignal): Promise<InspectorJob>
  document(signal?: AbortSignal): Promise<ExtractionDocument | ComparisonDocument | null>
  /** The scenarios, fixtures and renderer bundles in fixtures mode, or `null` when the Inspector isn't in fixtures mode. */
  fixtures(signal?: AbortSignal): Promise<FixtureCatalog | null>
  /** Resolves with the fixtures generation once it differs from `since`, or after the server's wait (unchanged). */
  fixtureChanges(since: number, signal?: AbortSignal): Promise<number>
  /**
   * Repository mode: resolves once the working tree's generation differs from
   * `since` (or after the server's wait), naming what changed; `null` when the
   * runner doesn't watch the working tree.
   */
  changes(since: number, signal?: AbortSignal): Promise<InspectorWorkspaceChanges | null>
  /** Repository mode: the working tree's projection's renderer package scenarios, as extraction documents. */
  scenarios(projectionId: string, signal?: AbortSignal): Promise<InspectorScenarioList>
  /** Repository mode: the projections explore proposes for this repository, and whether this is an explore session. */
  explore(signal?: AbortSignal): Promise<ExploreCandidates>
  /**
   * Repository mode: starts a history sweep (cancelling the one before) of `projections` (default: the candidates and
   * adopted ones) across the `last` changes (`0`: only `pairs`), and `pairs` such as bookmarks, at their commits.
   */
  startSweep(
    request: {projections?: string[]; last?: number; pairs?: {before: string; after: string; title?: string}[]},
    signal?: AbortSignal,
  ): Promise<{id: string}>
  /** Repository mode: stops the running sweep, keeping what it found. */
  cancelSweep(signal?: AbortSignal): Promise<void>
  /** Repository mode: the latest history sweep, or `null` before one starts. */
  sweep(signal?: AbortSignal): Promise<Sweep | null>
  /** Repository mode: a changed sweep cell's Diff as a PNG, in `theme`'s colour mode (light by default). */
  sweepThumbnail(cell: {projection: string; before: string; after: string; theme?: 'light' | 'dark'}, signal?: AbortSignal): Promise<Blob>
  /**
   * Repository mode: adopts explore candidates (writes their definitions and bookmarks each one's `bookmarks`
   * most-changed changes from the latest sweep). `dryRun` previews; writing needs the preview's `digest`.
   */
  adopt(
    request: {projections: string[]; bookmarks?: number; dryRun?: boolean; digest?: string},
    signal?: AbortSignal,
  ): Promise<OnboardingWrite>
  /** Repository mode: bookmarks, tags, branches, the merge base and the suggested pairs, with the default first. */
  pairs(projectionId: string | undefined, signal?: AbortSignal): Promise<InspectorPairs>
  /**
   * Repository mode: saves parts (`extractor`, `comparator`, `renderer`; `null` removes an optional one) to the
   * projection's definition file. `dryRun` previews it; saving needs the preview's `digest` and an Inspector started
   * with `--trust`.
   */
  saveDefinition(
    request: {projectionId: string; parts: Record<string, unknown>; dryRun?: boolean; digest?: string},
    signal?: AbortSignal,
  ): Promise<InspectorDefinitionSave>
}
