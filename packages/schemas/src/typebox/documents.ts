import Type from 'typebox'
import {ComparisonSchema} from './comparison.js'
import {DefinitionSchema, DeterminismClass, Identifier, RendererReference, ReproducibilityLevel} from './definition.js'
import {ExtractionSchema} from './extraction.js'
import {annotated, Closed, define, Dictionary} from './support.js'

const NonEmpty = Type.String({minLength: 1})
const Notice = Type.String({minLength: 1, maxLength: 4096})

// Saved extraction ------------------------------------------------------------------------------------------------

const Sha256 = define('extraction-document', 'sha256', Type.String({pattern: '^[0-9a-f]{64}$'}))
const CommitSha = () => Type.String({pattern: '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'})

/** The JSON Schema of a `Revision`, the saved extraction schema's `$defs/revision`. */
export const RevisionSchema = define(
  'extraction-document',
  'revision',
  Closed(
    {kind: Type.Enum(['commit', 'working-tree']), ref: NonEmpty, commit: CommitSha(), dirty: Type.Boolean()},
    {if: {properties: {kind: {const: 'commit'}}}, then: {properties: {dirty: {const: false}}}},
  ),
)

const TreeSha = () => Type.String({pattern: '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'})
const ScopePath = () =>
  Type.String({
    minLength: 1,
    maxLength: 1024,
    description: 'A repository-relative file or directory, `/`-separated, without `.` or `..` segments.',
  })

/**
 * The JSON Schema of a saved extraction's `provenance.execution`, the saved extraction schema's `$defs/execution`:
 * where the runner extracted it, how faithfully, and in what environment.
 */
export const ExecutionSchema = define(
  'extraction-document',
  'execution',
  Closed(
    {
      source: Type.Enum(['ci', 'local-in-place', 'local-git-objects', 'local-workspace', 'local-materialized'], {
        description:
          "Where it was extracted: reused from a CI artifact (`ci`), in the user's checkout (`local-in-place`), read from Git objects with nothing on disk (`local-git-objects`), in a reused workspace (`local-workspace`), or in a temporary copy (`local-materialized`).",
      }),
      fidelity: Type.Enum(['exact', 'approximate', 'stale'], {
        description:
          '`exact`; `approximate` when a toolchain extractor borrowed dependencies installed for different lockfiles; `stale` when the working tree changed while it ran.',
      }),
      tree: Type.Optional(annotated(TreeSha(), {description: 'The examined Git tree.'})),
      strategy: Type.Optional(
        Type.Enum(['fresh', 'worktree', 'clone', 'sparse'], {description: 'The workspace strategy, for a workspace or temporary copy.'}),
      ),
      prepared: Type.Optional(
        Type.Array(
          Closed({
            id: Type.String({pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$'}),
            key: Type.String({pattern: '^sha256:[0-9a-f]{64}$'}),
          }),
          {maxItems: 50, description: "The environment's prepare steps that applied, with their key hashes."},
        ),
      ),
      scope: Type.Optional(Type.Array(ScopePath(), {description: 'The enforced scope, when one applied.'})),
      determinism: Type.Optional(DeterminismClass),
      environment: Type.Optional(
        Type.String({
          pattern: '^sha256:[0-9a-f]{64}$',
          description: "Fingerprint of the run's environment: the Projections version, `PATH` and the granted variables' values, hashed.",
        }),
      ),
      at: Type.Optional(
        Type.String({pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$', description: 'When the run happened, in UTC.'}),
      ),
      official: Type.Optional(
        Type.Boolean({
          description:
            "True for the run the repository's own CI published, authenticated (`ci.authentication`): the commit's official extraction. False for an imported artifact nothing authenticated.",
        }),
      ),
      ci: Type.Optional(
        Closed(
          {
            repository: NonEmpty,
            run: Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}),
            workflow: Type.Optional(NonEmpty),
            authentication: Type.Optional(
              Type.Enum(['download', 'attestation'], {
                description:
                  "How the run was established: `download` when the CLI downloaded the artifact from a run GitHub's API identified as the repository's own Projections workflow, `attestation` when an imported artifact's attestation verified and named such a run. Absent for an unauthenticated import, whose manifest alone names the run.",
              }),
            ),
          },
          {description: 'The CI run whose artifact supplied it.'},
        ),
      ),
    },
    {description: 'Where and how faithfully the runner extracted it.'},
  ),
)

/** The JSON Schema of a saved extraction's `Provenance`. */
export const ProvenanceSchema = Closed({
  revision: RevisionSchema,
  extractor: Closed({id: NonEmpty, version: NonEmpty}),
  definition: DefinitionSchema,
  definitionDigest: Type.String({
    description: '`sha256:` digest of the canonical definition and its declared sources.',
    pattern: '^sha256:[0-9a-f]{64}$',
  }),
  reproducibility: ReproducibilityLevel,
  limitations: Type.Array(NonEmpty),
  toolchain: Type.Optional(Dictionary(NonEmpty)),
  execution: Type.Optional(ExecutionSchema),
  generated: Type.Optional(
    Closed(
      {
        values: Type.Integer({minimum: 0, description: 'The concrete generated values in the extraction.'}),
        reused: Type.Integer({minimum: 0, description: 'How many reused a stored value: the same declared path, basis digest and value.'}),
        sources: Type.Array(Type.Enum(['local', 'ci']), {
          uniqueItems: true,
          description: 'The generation stores the reused values came from: `local`, or `ci` for values harvested from a CI artifact.',
        }),
      },
      {description: 'Generated values the extraction holds, and how many the generation store supplied.'},
    ),
  ),
})

/** The JSON Schema of an `ExtractionDocument`, the root of the published `extraction-document/v0.json`. */
export const ExtractionDocumentSchema = define(
  'extraction-document',
  undefined,
  Closed(
    {
      format: Type.Literal('projections.extraction'),
      version: Type.Literal(0),
      projection: Closed({id: Identifier, title: NonEmpty, renderer: RendererReference}),
      extraction: ExtractionSchema,
      provenance: ProvenanceSchema,
      digest: annotated(Sha256, {description: 'Lowercase SHA-256 of the canonical extraction bytes.'}),
    },
    {description: 'An extraction with runner-added provenance and its semantic digest.'},
  ),
)

// Saved comparison -----------------------------------------------------------------------------------------------

/**
 * The JSON Schema of a `ComparisonDocument`, the root of the published `comparison-document/v0.json`, with at most 20
 * notices.
 */
export const ComparisonDocumentSchema = define(
  'comparison-document',
  undefined,
  Closed(
    {
      format: Type.Literal('projections.comparison'),
      version: Type.Literal(0),
      before: ExtractionDocumentSchema,
      after: ExtractionDocumentSchema,
      comparison: ComparisonSchema,
      comparator: Closed({id: NonEmpty, digest: Type.String({pattern: '^sha256:[0-9a-f]{64}$'})}),
      notices: Type.Optional(
        Type.Array(Notice, {
          description:
            'Informational: how the compared revisions define the projection differently, for example a changed definition or a projection missing at one revision. Not verified.',
          maxItems: 20,
        }),
      ),
    },
    {description: 'Two saved extractions and the comparison between them, with the comparator that produced it.'},
  ),
)

// Extractor stdin ------------------------------------------------------------------------------------------------

/** The JSON Schema of an `ExtractorRequest`, the root of the published `extractor-request/v0.json`. */
export const ExtractorRequestSchema = define(
  'extractor-request',
  undefined,
  Closed(
    {
      protocolVersion: Type.Literal(0),
      projection: Closed({id: Identifier, definition: DefinitionSchema}),
      repository: Closed({
        mode: Type.Enum(['in-place', 'workspace', 'materialized', 'git-objects'], {
          description:
            "How the revision is given: the user's checkout read in place, a reused workspace, a temporary materialization, or Git objects with nothing on disk.",
        }),
        root: Type.Optional(
          Type.String({
            minLength: 1,
            description: 'The directory holding the examined revision. Absent in `git-objects` mode.',
          }),
        ),
        git: Type.Optional(
          Closed({directory: NonEmpty, tree: TreeSha()}, {description: 'In `git-objects` mode: the Git directory and the examined tree.'}),
        ),
        revision: RevisionSchema,
        project: Type.Optional(
          Type.String({
            maxLength: 1024,
            pattern:
              '^(?:[^/.\\\\][^/\\\\]*|\\.[^/.\\\\][^/\\\\]*|\\.\\.[^/\\\\]+)(?:/(?:[^/.\\\\][^/\\\\]*|\\.[^/.\\\\][^/\\\\]*|\\.\\.[^/\\\\]+))*$|^$',
            description:
              "The definition's project: the directory holding its `.github/projections` or `.projections`, relative to `root` (and to the Git tree in `git-objects` mode), `/`-separated; empty for the repository's root. The definition's paths and inputs are relative to it, and the extractor runs there. Absent means the root.",
          }),
        ),
        checkout: Type.Optional(
          Type.String({
            minLength: 1,
            description:
              "Where the repository's dependencies (such as `node_modules`) are installed for this run: the root itself in place or in a prepared workspace, or the user's checkout when a materialized revision borrows them; a nested project's are in its `project` directory there. Absent under container isolation and in `git-objects` mode.",
          }),
        ),
        scope: Type.Optional(
          Type.Array(ScopePath(), {
            description:
              "The enforced scope, repository-relative (the definition's own, resolved from its project): files outside it are not listed and reads fail.",
          }),
        ),
      }),
      capabilities: Closed({trusted: Type.Boolean(), network: Type.Boolean()}),
      upstream: Type.Optional(
        Dictionary(ExtractionSchema, {
          description:
            "The normalized extractions of the definition's `extractor.upstream` built-ins, keyed by the names the definition gives them. Present only when it declares some.",
        }),
      ),
      generations: Type.Optional(
        Closed(
          {
            file: Type.String({
              minLength: 1,
              description:
                'A read-only JSON Lines snapshot of the generation store: one `{"path", "basis", "value"}` per line, keyed by a generated declaration\'s `path` and its basis digest.',
            }),
          },
          {description: 'Earlier generated values to reuse for an equal basis. Absent when the store is empty or the run regenerates.'},
        ),
      ),
    },
    {description: 'The document an extractor receives on stdin.'},
  ),
)

// CI artifact manifest -------------------------------------------------------------------------------------------

const artifact = 'artifact'
const ArtifactCommit = define(artifact, 'commit', CommitSha())
const PositiveId = define(artifact, 'id', Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}))
const Notices = define(artifact, 'notices', Type.Array(Notice, {maxItems: 20}))
const ArtifactPath = define(artifact, 'path', Type.String({pattern: '^projections/[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}\\.json$'}))
const ArtifactSha256 = define(artifact, 'sha256', Type.String({pattern: '^[0-9a-f]{64}$'}))
const ProjectionId = Type.String({pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$'})
const Bounded = (maxLength: number) => Type.String({minLength: 1, maxLength})

/**
 * The JSON Schema of a `Diagnostic` in a CI artifact manifest, the artifact schema's `$defs/diagnostic`: bounded to a
 * 100-character code, 1024-character path and 4096-character message, without `entityId`.
 */
export const DiagnosticSchema = define(
  artifact,
  'diagnostic',
  Closed({
    severity: Type.Enum(['error', 'warning']),
    code: Bounded(100),
    path: Type.String({maxLength: 1024}),
    message: Bounded(4096),
  }),
)

/**
 * The JSON Schema of an `ArtifactSubject`: a pull request (its number, base, head and merge-base commits, and which
 * side's definitions were used) or a push (its `refs/heads/` or `refs/tags/` ref and commit).
 */
export const ArtifactSubjectSchema = Type.Union([
  Closed({
    kind: Type.Literal('pull-request'),
    number: PositiveId,
    base: ArtifactCommit,
    head: ArtifactCommit,
    mergeBase: ArtifactCommit,
    definition: Type.Enum(['base', 'head']),
  }),
  Closed({
    kind: Type.Literal('push'),
    ref: Type.String({pattern: '^refs/(?:heads|tags)/[^\\u0000-\\u001f\\u007f]{1,250}$'}),
    revision: ArtifactCommit,
  }),
])

/** The JSON Schema of an `ArtifactProjection`: a document at `projections/<id>.json`, or an error. */
export const ArtifactProjectionSchema = Type.Union([
  Closed({
    id: ProjectionId,
    status: Type.Enum(['changed', 'unchanged', 'extracted', 'head-only', 'base-only']),
    path: ArtifactPath,
    sha256: ArtifactSha256,
    notices: Type.Optional(Notices),
  }),
  Closed({
    id: ProjectionId,
    status: Type.Literal('error'),
    title: Type.Optional(Bounded(200)),
    diagnostics: Type.Array(DiagnosticSchema, {minItems: 1, maxItems: 20}),
    notices: Type.Optional(Notices),
  }),
])

/**
 * The JSON Schema of an `ArtifactManifest`, the root of the published `artifact/v0.json`: the producer, repository,
 * run, subject and `trust`, and at most 60 projections.
 */
export const ArtifactManifestSchema = define(
  artifact,
  undefined,
  Closed(
    {
      format: Type.Literal('projections.artifact'),
      version: Type.Literal(0),
      protocolVersion: Type.Literal(0),
      producer: Closed({cli: Bounded(100), action: Type.Optional(Bounded(200))}),
      repository: Closed({provider: Type.Literal('github'), id: PositiveId, owner: Bounded(100), name: Bounded(100)}),
      run: Closed({id: PositiveId, attempt: PositiveId}),
      subject: ArtifactSubjectSchema,
      trust: Type.Boolean({
        description: 'Whether the workflow author passed `--trust`, allowing extractors that run repository code.',
      }),
      projections: Type.Array(ArtifactProjectionSchema, {maxItems: 60}),
    },
    {
      description:
        'projections.artifact.json at the root of the `projections` Actions artifact: what one workflow run extracted or compared, and the full-byte SHA-256 of every document it uploaded.',
    },
  ),
)
