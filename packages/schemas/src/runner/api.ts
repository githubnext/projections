// The local runner's HTTP API responses that its clients (the Inspector, editors) decode: the CLI's
// `projections view` / `serve --stdio` service. Internal and unversioned: the runner and its clients ship from
// the same commit, so these are not published with the versioned schemas. `internal/runner-api.json` is
// generated from them, and the CLI's service tests check every response the Rust service writes against it.
import Type, {type Static, type TProperties, type TSchema} from 'typebox'
import type {ComparisonDocument, Definition, ExtractionDocument} from '../index.js'
import {Dictionary} from '../typebox/support.js'

const Count = Type.Integer({minimum: 0, maximum: Number.MAX_SAFE_INTEGER})
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()])

/**
 * A document another boundary validates, opaque here: only the envelope fields the clients read are checked, and
 * any other property is allowed, which the CLI's conformance check otherwise refuses.
 */
function Opaque<T>(properties: TProperties, description: string) {
  return Type.Unsafe<T>(Type.Object(properties, {additionalProperties: true, description}))
}

/** A change a history sweep tries: a revision against the one before it. */
export const SweepChangeSchema = Type.Object({
  before: Type.String(),
  after: Type.String(),
  title: Type.String(),
  number: Nullable(Type.Integer({description: 'The pull request number its message names, if any.'})),
  kind: Type.Enum(['merge', 'commit', 'pair']),
  date: Type.String(),
})

/** A swept projection: `ready`, or skipped because it needs `--trust`, or failed to prepare. */
export const SweepProjectionSchema = Type.Object({
  projection: Type.String(),
  status: Type.Enum(['ready', 'trust', 'failed']),
  requiresTrust: Type.Optional(Type.Boolean()),
  error: Type.Optional(Type.String()),
})

/** One projection on one change. */
export const SweepCellSchema = Type.Object({
  projection: Type.String(),
  before: Type.String(),
  after: Type.String(),
  status: Type.Enum(['changed', 'unchanged', 'failed']),
  changes: Type.Optional(Count),
  steps: Type.Optional(Count),
  counts: Type.Optional(Dictionary(Count, {description: 'Changes by status (`added`, `removed`, `modified`, …).'})),
  error: Type.Optional(Type.String()),
  stderr: Type.Optional(Type.String({description: "The end of a failed extractor's stderr."})),
})

/** A history sweep. */
export const SweepSchema = Type.Object({
  id: Type.String(),
  status: Type.Enum(['running', 'completed', 'failed', 'cancelled']),
  error: Nullable(Type.String()),
  changes: Type.Array(SweepChangeSchema),
  projections: Type.Array(SweepProjectionSchema),
  cells: Type.Array(SweepCellSchema),
})

/** A projection `projections explore` proposes for this repository, as a trial definition. */
export const ExploreCandidateSchema = Type.Object({
  id: Type.String({description: "The trial definition's ID: the built-in extractor's."}),
  title: Type.String(),
  description: Type.String(),
  extractor: Type.String(),
  schema: Type.String(),
  renderer: Type.String(),
  requiresTrust: Type.Boolean(),
  basis: Type.Object(
    {
      pattern: Type.String(),
      count: Count,
      examples: Type.Array(Type.String()),
      skipped: Type.Optional(Count),
    },
    {description: 'Why it was proposed: the detection pattern that matched, how many files and the first few.'},
  ),
  adopted: Nullable(Type.String({description: 'The authored definition that already uses it, if any.'})),
  definition: Opaque<Definition>({}, 'The trial definition, which the runner loads and validates as it does any definition.'),
})

/** A file Adopt would write: its current content (`null` when absent) and new content. */
export const OnboardingFileSchema = Type.Object({
  path: Type.String(),
  before: Nullable(Type.String()),
  after: Type.String(),
  created: Type.Boolean(),
  changed: Type.Boolean(),
})

/** A Before → After pair the repository suggests. */
export const PairSchema = Type.Object({
  before: Type.Optional(Type.String({description: 'Absent for one revision alone.'})),
  after: Type.String(),
  label: Type.String(),
  source: Type.Enum(['bookmark', 'merge-base', 'tag', 'parent', 'working-tree', 'head']),
  bookmark: Type.Optional(Type.String({description: "The bookmark's ID, for `source: 'bookmark'`."})),
  identical: Type.Optional(Type.Boolean({description: 'Both sides hold the same files, so the comparison is empty.'})),
  backwards: Type.Optional(Type.Boolean({description: "A bookmark whose After is older than its Before; it's never the default."})),
  error: Type.Optional(Type.String({description: "Why it can't be compared here, for example a ref that doesn't exist."})),
})

/** `POST /api/adopt`: an Adopt preview or result. */
export const AdoptResponseSchema = Type.Object({
  files: Type.Array(OnboardingFileSchema),
  digest: Type.String({description: "The files' current contents, which writing must still find."}),
  written: Type.Boolean(),
  adopted: Type.Optional(Type.Array(Type.String())),
  bookmarked: Type.Optional(Type.Array(Type.Object({id: Type.String(), projection: Type.String(), change: SweepChangeSchema}))),
})

/** `GET /api/explore`. */
export const ExploreResponseSchema = Type.Object({
  session: Type.Boolean({
    description: 'Whether this Inspector is an explore session (no projections yet), whose candidates every revision defines.',
  }),
  candidates: Type.Array(ExploreCandidateSchema),
})

/** `POST /api/sweep` starting a sweep. */
export const SweepStartResponseSchema = Type.Object({id: Type.String(), status: Type.Literal('running')})

/** `GET /api/sweep`, and `POST /api/sweep` cancelling one: the latest sweep, or `null` before one starts. */
export const SweepResponseSchema = Type.Object({sweep: Nullable(SweepSchema)})

/**
 * `GET /api/pairs`: what the runner offers as Before → After pairs: `HEAD` and the default branch, their merge base,
 * the bookmarks (or `bookmarksError`), tags and branches, the suggestions in the order the default is chosen from,
 * and `default`, the pair a projection opens on. Commits are full hashes; dates are ISO 8601.
 */
export const PairsResponseSchema = Type.Object({
  head: Type.Object({commit: Nullable(Type.String()), branch: Nullable(Type.String()), dirty: Type.Boolean()}),
  defaultBranch: Nullable(Type.String()),
  mergeBase: Nullable(Type.String()),
  bookmarks: Type.Array(
    Type.Object({id: Type.String(), title: Type.String(), projectionId: Type.String(), before: Type.String(), after: Type.String()}),
  ),
  tags: Type.Array(Type.Object({name: Type.String(), commit: Type.String(), date: Type.String()})),
  branches: Type.Array(Type.Object({name: Type.String(), commit: Type.String(), date: Type.String(), current: Type.Boolean()})),
  suggestions: Type.Array(PairSchema),
  default: PairSchema,
  bookmarksError: Type.Optional(Type.String()),
})

/** `POST /api/definition`: what saving parts writes (`dryRun`), or wrote. */
export const DefinitionSaveResponseSchema = Type.Object({
  path: Type.String({description: 'The definition file, relative to the repository.'}),
  before: Type.String(),
  after: Type.String(),
  digest: Type.String({description: "The file's digest before saving; pass it back to save exactly this preview."}),
  changed: Type.Boolean(),
  written: Type.Boolean(),
})

/**
 * `GET /api/changes`: what changed in the working tree since a generation (`definitions`, `working-tree`,
 * `extractor:<id>`, `renderer:<id>`, `comparator:<id>`); `complete` is false when the runner no longer knows every
 * change since then.
 */
export const ChangesResponseSchema = Type.Object({
  generation: Count,
  changes: Type.Array(Type.String()),
  complete: Type.Boolean(),
  tree: Type.Optional(Type.String({description: "The working tree's identity at `generation`."})),
})

/** `GET /api/fixtures/changes`: the fixtures generation. */
export const FixturesChangesResponseSchema = Type.Object({generation: Count})

/** `GET /api/document`: the saved document an offline Inspector presents, or `null`. */
export const DocumentResponseSchema = Type.Object({
  document: Nullable(
    Opaque<ExtractionDocument | ComparisonDocument>(
      {format: Type.Enum(['projections.extraction', 'projections.comparison']), version: Type.Literal(0)},
      'A saved document, which the runner validated when it loaded it.',
    ),
  ),
})

/** Each decoded response by name: the request it answers and its schema. */
export const runnerResponses = {
  adopt: {request: 'POST /api/adopt', schema: AdoptResponseSchema},
  explore: {request: 'GET /api/explore', schema: ExploreResponseSchema},
  sweepStart: {request: 'POST /api/sweep', schema: SweepStartResponseSchema},
  sweep: {request: 'GET /api/sweep', schema: SweepResponseSchema},
  pairs: {request: 'GET /api/pairs', schema: PairsResponseSchema},
  definitionSave: {request: 'POST /api/definition', schema: DefinitionSaveResponseSchema},
  changes: {request: 'GET /api/changes', schema: ChangesResponseSchema},
  fixturesChanges: {request: 'GET /api/fixtures/changes', schema: FixturesChangesResponseSchema},
  document: {request: 'GET /api/document', schema: DocumentResponseSchema},
} as const satisfies {[name: string]: {request: string; schema: TSchema}}

/** The name of a decoded runner response, such as `explore`. */
export type RunnerResponseName = keyof typeof runnerResponses
/** The decoded type of the runner response `N`. */
export type RunnerResponse<N extends RunnerResponseName> = Static<(typeof runnerResponses)[N]['schema']>

/** A change a history sweep tries: a revision against the one before it. */
export type SweepChange = Static<typeof SweepChangeSchema>
/** A swept projection: `ready`, or skipped because it needs `--trust`, or failed to prepare. */
export type SweepProjection = Static<typeof SweepProjectionSchema>
/** One projection on one change of a history sweep. */
export type SweepCell = Static<typeof SweepCellSchema>
/** A history sweep (`GET /api/sweep`). */
export type Sweep = Static<typeof SweepSchema>
/** A projection `projections explore` proposes for this repository, as a trial definition. */
export type ExploreCandidate = Static<typeof ExploreCandidateSchema>
/** The explore candidates (`GET /api/explore`), and whether this is an explore session. */
export type ExploreCandidates = Static<typeof ExploreResponseSchema>
/** A file Adopt would write: its current content (`null` when absent) and new content. */
export type OnboardingFile = Static<typeof OnboardingFileSchema>
/** An Adopt preview or result (`POST /api/adopt`). */
export type OnboardingWrite = Static<typeof AdoptResponseSchema>
/** A Before → After pair the repository suggests. */
export type Pair = Static<typeof PairSchema>
/** What the runner offers as Before → After pairs (`GET /api/pairs`). */
export type Pairs = Static<typeof PairsResponseSchema>
/** What saving definition parts writes, or wrote (`POST /api/definition`). */
export type DefinitionSave = Static<typeof DefinitionSaveResponseSchema>
/** What changed in the working tree since a generation (`GET /api/changes`). */
export type WorkspaceChanges = Static<typeof ChangesResponseSchema>

/** The generated `internal/runner-api.json`: each response's schema as the `$defs` entry of its name. */
export function runnerApiSchema(): {[key: string]: unknown} {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Projections local runner API responses (internal)',
    description:
      'Generated from packages/schemas/src/runner/api.ts; internal and unversioned, never published. Each $defs entry is one response, and x-request names the request it answers.',
    $defs: Object.fromEntries(
      Object.entries(runnerResponses).map(([name, {request, schema}]) => [
        name,
        {'x-request': request, ...JSON.parse(JSON.stringify(schema))},
      ]),
    ),
  }
}
