import type {Static} from 'typebox'
import type {DomainSchema, Json, Vocabulary} from './constants.js'
import type {DataOf, TypedKind} from './domains.js'
import type {ChangeSchema, ComparisonSchema, ContextSchema, StepSchema, VariedSchema} from './typebox/comparison.js'
import type {
  DefaultComparatorSchema,
  DefaultComparatorOptionsSchema,
  CommandExtractorSchema,
  DefinitionSchema,
  CustomComparatorSchema,
  KindPresentationSchema,
  PresentationSettingsSchema,
  RendererBundleSchema,
} from './typebox/definition.js'
import type {
  ArtifactManifestSchema,
  ArtifactProjectionSchema,
  ArtifactSubjectSchema,
  ComparisonDocumentSchema,
  ExtractionDocumentSchema,
  ExtractorRequestSchema,
  ProvenanceSchema,
  RevisionSchema,
} from './typebox/documents.js'
import type {
  EntitySchema,
  EvidenceSchema,
  ExtractionSchema,
  RelationshipSchema,
  ToleranceSchema,
  VolatileSchema,
} from './typebox/extraction.js'
import type {ScenarioComparatorSchema, ScenarioSchema, ScenariosDocumentSchema} from './typebox/scenarios.js'

/* eslint-disable @typescript-eslint/no-empty-object-type -- Named interfaces over the schemas' static types keep declarations and reference docs readable. */

// The document types are the static types of the TypeBox schemas in `./typebox`, which also generate the
// published JSON Schemas. This entry imports them as types only, so it never loads TypeBox at runtime.

export {customComparator, isComparatorFile} from './comparator.js'
export {
  domainSchemas,
  kindColors,
  kindHues,
  kindTones,
  protocolVersion,
  schemaBaseUrl,
  schemaUrl,
  vocabularyNames,
  type DomainSchema,
  type Json,
  type KindColor,
  type Vocabulary,
} from './constants.js'

/**
 * How sure an extractor is of an item: `authoritative` when the tool that owns the fact recorded it (such as a
 * container's own resolution), `derived` when the extractor applied that tool's rules itself, `inferred` for a
 * heuristic guess. Descriptive only, and part of the canonical content and digest.
 */
export type Confidence = 'authoritative' | 'derived' | 'inferred'
/**
 * How well a definition's toolchain is pinned (`execution.reproducibility`), recorded in provenance and independent of
 * its determinism class: `hermetic`, `pinned-toolchain` (such as an exact container image digest), `local` (the
 * honest default for a developer's machine), `unknown` or `external`. Declared, never enforced.
 */
export type Reproducibility = 'hermetic' | 'pinned-toolchain' | 'local' | 'unknown' | 'external'

/**
 * Where an extractor found an item: the analysis that saw it (`kind`, such as `typescript`), the repository file
 * (`source`) and optionally a 1-based `line` and `column`. An untrusted claim, excluded from the canonical content
 * and digest.
 */
export interface Evidence extends Static<typeof EvidenceSchema> {}
/**
 * A thing an extraction describes: a unique nonblank `id`, its `kind`, a `label` (required, may be empty) and optional
 * `data`, `previousIds` (identity continuity, never fuzzy matching), `evidence` and `confidence`. IDs are unique
 * across entities and relationships.
 */
export interface Entity extends Static<typeof EntitySchema> {}
/** Data an extraction declares may vary between runs at one revision, and how much. */
export interface Volatile extends Static<typeof VolatileSchema> {}
/**
 * How much a volatile numeric value may vary between runs and still be the same: within when any declared bound
 * holds (`absolute`, `relative`, or `spread` scaled by `factor`). Values that are not numbers on both sides are
 * beyond.
 */
export interface Tolerance extends Static<typeof ToleranceSchema> {}
/**
 * A directed connection `from` one entity `to` another, both of which must exist in the extraction, with a unique
 * `id`, its `kind`, an optional `label` and the same optional `data`, `previousIds`, `evidence` and `confidence` as an
 * entity.
 */
export interface Relationship extends Static<typeof RelationshipSchema> {}
/** One aspect of the code at one revision, as an extractor writes it to stdout. */
export interface Extraction extends Omit<Static<typeof ExtractionSchema>, 'entities' | 'relationships'> {
  entities: Entity[]
  relationships: Relationship[]
}

// Domain schemas ------------------------------------------------------------------------------------------------

export {dataRules, domainDescriptions, fieldTypes, vocabularies} from './domains.js'
export {apiDeclarationKinds, apiDeclarations} from './api-contract.js'
export type {DataOf, DataRule, FieldRule, FieldType, FieldValues, PrimitiveType, Shape, TypedData, TypedKind, ValueOf} from './domains.js'

/**
 * An entity of an extraction in domain schema `S` that declares vocabularies `V`, as the engine guarantees
 * it: the kinds they type carry their typed `data`, and every entity the fields required of all kinds.
 * Narrow by kind with `isKind`. `data` is always present once the engine has normalized an extraction.
 */
export type EntityOf<S extends DomainSchema, V extends Vocabulary = never> =
  | {[K in TypedKind<S, 'entities', V>]: Omit<Entity, 'kind' | 'data'> & {kind: K; data: DataOf<S, 'entities', K, V>}}[TypedKind<
      S,
      'entities',
      V
    >]
  | (Omit<Entity, 'data'> & {data: DataOf<S, 'entities', string, V>})
/** A relationship of an extraction in domain schema `S` that declares vocabularies `V`, as the engine guarantees it. */
export type RelationshipOf<S extends DomainSchema, V extends Vocabulary = never> =
  | {
      [K in TypedKind<S, 'relationships', V>]: Omit<Relationship, 'kind' | 'data'> & {kind: K; data: DataOf<S, 'relationships', K, V>}
    }[TypedKind<S, 'relationships', V>]
  | (Omit<Relationship, 'data'> & {data: DataOf<S, 'relationships', string, V>})
/** A normalized extraction in domain schema `S` declaring vocabularies `V`, with its items' typed `data`. */
export interface ExtractionOf<S extends DomainSchema, V extends Vocabulary = never> extends Omit<
  Extraction,
  'schema' | 'entities' | 'relationships'
> {
  schema: S
  entities: EntityOf<S, V>[]
  relationships: RelationshipOf<S, V>[]
}
/** A normalized extraction in any domain schema, discriminated by `schema`. */
export type DomainExtraction = {[S in DomainSchema]: ExtractionOf<S>}[DomainSchema]
/** A normalized `graph/v0` extraction: entities and directed relationships, with no typed `data`. */
export type GraphExtraction = ExtractionOf<'graph/v0'>
/** A normalized `dag/v0` extraction: a graph the engine has checked has no cycles. */
export type DagExtraction = ExtractionOf<'dag/v0'>
/** A normalized `treemap/v0` extraction: a containment forest whose leaves carry a nonnegative `data.value`. */
export type TreemapExtraction = ExtractionOf<'treemap/v0'>
/** A normalized `metrics/v0` extraction: every entity carries a numeric `data.value` and optionally a `data.unit`. */
export type MetricsExtraction = ExtractionOf<'metrics/v0'>
/** A normalized `api/v0` extraction: declaration entities carry `data.signature`, and optionally `data.contract`. */
export type ApiExtraction = ExtractionOf<'api/v0'>
/** A normalized `database/v0` extraction: tables, columns, keys and constraints; columns carry `data.type`. */
export type DatabaseExtraction = ExtractionOf<'database/v0'>
/** A normalized `architecture/v0` extraction that declares no vocabulary: components and their connections. */
export type ArchitectureExtraction = ExtractionOf<'architecture/v0'>
/** A normalized `architecture/v0` extraction declaring `dependency-injection/v0`, with its kinds' typed `data`. */
export type DependencyInjectionExtraction = ExtractionOf<'architecture/v0', 'dependency-injection/v0'>
/** A normalized `architecture/v0` extraction declaring `infrastructure/v0`, with its kinds' typed `data`. */
export type InfrastructureExtraction = ExtractionOf<'architecture/v0', 'infrastructure/v0'>
/** A normalized `architecture/v0` extraction declaring `runtime-policy/v0`, with its kinds' typed `data`. */
export type RuntimePolicyExtraction = ExtractionOf<'architecture/v0', 'runtime-policy/v0'>
/** A normalized `architecture/v0` extraction declaring `agentic-workflows/v0`, with its kinds' typed `data`. */
export type AgenticWorkflowsExtraction = ExtractionOf<'architecture/v0', 'agentic-workflows/v0'>

/** The item, narrowed to kind `K`: with its typed `data` when its schema types `K`. */
export type OfKind<T extends {kind: string}, K extends string> = [Extract<T, {kind: K}>] extends [never]
  ? T & {kind: K}
  : Extract<T, {kind: K}>

/** Whether `item` is of `kind`, narrowing it to that kind's typed `data` (`isKind(entity, 'column')`). */
export function isKind<T extends {kind: string}, K extends string>(item: T, kind: K): item is OfKind<T, K> {
  return item.kind === kind
}

/**
 * One problem the engine, a loader or a check found. An `EngineError` carries only errors; warnings report something
 * that did not stop the operation.
 */
export interface Diagnostic {
  /** `error` when the input was rejected; `warning` when it was accepted with a concern. */
  severity: 'error' | 'warning'
  /** A stable, machine-readable code, such as `depth-limit` or `comparator-error`. */
  code: string
  /** JSON Pointer to the offending value in the input; empty for the whole document. */
  path: string
  /** Human-readable prose; inline code is marked with backticks (see `proseSpans`). */
  message: string
  /** The item the problem concerns, when the producer names one. */
  entityId?: string
}

/**
 * What happened to an item between two extractions. `unchanged` appears only for identity-only changes (`declared`,
 * `split`, `merge`) and for pairs whose only differences are volatile values within tolerance.
 */
export type ChangeStatus = 'unchanged' | 'added' | 'removed' | 'modified'
/**
 * How a change's before and after IDs correspond: `exact` pairs an ID with itself, `declared` two different IDs a
 * `previousIds` claim joins, `split` one before ID with two or more after, `merge` two or more before with one after,
 * and `none` an addition or removal.
 */
export type Correspondence = 'exact' | 'declared' | 'split' | 'merge' | 'none'
/** Which of an extraction's arrays an item belongs to; entities and relationships are matched independently. */
export type Collection = 'entities' | 'relationships'
/**
 * One item's change: its `collection`, `before` and `after` IDs, `status` and `correspondence`, whose shapes must
 * agree (an addition has no before ID and one after ID, for example), with any volatile values that `varied`, an
 * optional prose `summary` and its `context`. Its `id` is unique within the comparison.
 */
export interface Change extends Static<typeof ChangeSchema> {}
/**
 * A change's `context`: the other items, by ID in each revision, that a person needs to read it (the core's, a changed
 * relationship's endpoints and the items containing what changed, and what comparator `context` rules add, named in
 * `rules`).
 */
export interface ChangeContext extends Static<typeof ContextSchema> {}
/** A volatile value that differs between a matched pair, and whether within tolerance. */
export interface Varied extends Static<typeof VariedSchema> {}
/**
 * One stage of a comparison's presentation: the IDs of the `changes` it shows together, in order, with an optional
 * `kind` (`remove`, `restructure` or `add`) and prose `summary`. Every change that matters appears in exactly one
 * step; expected variation appears in none.
 */
export interface Step extends Static<typeof StepSchema> {}
/** How one extraction became another. Never contains positions, colors or timing. */
export interface Comparison extends Omit<Static<typeof ComparisonSchema>, 'changes' | 'steps' | 'reverseSteps'> {
  changes: Change[]
  steps: Step[]
  reverseSteps?: Step[]
}

/**
 * Options of the default comparator. `order.by` sorts steps within each phase by their members' largest value:
 * `dependents` (incoming relationships) or a numeric `data.<key>`, `descending` unless `direction` says otherwise.
 * Ties keep the default order, and steps without a value go last.
 */
export interface DefaultComparatorOptions extends Static<typeof DefaultComparatorOptionsSchema> {}
/**
 * A custom extractor: `command`, a program and its arguments run directly (never through a shell), which reads an
 * `ExtractorRequest` on stdin and writes an extraction to stdout, run from the definition's project; `sources`, the
 * files and directories its code lives in, part of the definition digest; and `upstream`, built-in extractions it
 * builds on. Its paths are relative to the definition's project.
 */
export interface CommandExtractor extends Static<typeof CommandExtractorSchema> {}
/**
 * The default comparator in a definition's object form, `{}` or `{options}`: an object without `file`, which always
 * means the default comparator.
 */
export interface DefaultComparator extends Static<typeof DefaultComparatorSchema> {}
/**
 * A custom comparator in its object form: a comparator file (`<name>.comparator.yaml`) run sandboxed over the
 * default comparator, with its options. A definition may also name the file alone, as a string.
 */
export interface CustomComparator extends Static<typeof CustomComparatorSchema> {}
/**
 * A custom renderer: `bundle`, a directory holding its `index.html` and `renderer.json`, and `sources`, the files and
 * directories its code is built from, part of the definition digest; both relative to the definition's project.
 */
export interface RendererBundle extends Static<typeof RendererBundleSchema> {}
/** How viewers present one extraction kind (`presentation.kinds.<kind>`): its color and its summary noun. */
export interface KindPresentation extends Static<typeof KindPresentationSchema> {}
/** Initial settings a definition gives viewers, who can still change them. */
export interface PresentationSettings extends Static<typeof PresentationSettingsSchema> {}
/** A projection definition, `.github/projections/<id>.json`. */
export interface Definition extends Omit<Static<typeof DefinitionSchema>, 'extractor' | 'comparator' | 'renderer' | 'presentation'> {
  extractor: string | CommandExtractor
  /** A comparator file's path or `{file, ...}` is a custom comparator; an object without `file` is the built-in one. */
  comparator?: string | CustomComparator | DefaultComparator
  renderer: string | RendererBundle
  /** Initial host and renderer settings for viewers, who can still change them. */
  presentation?: PresentationSettings
}

/**
 * An extraction in a scenarios file: inline, or the path (relative to the
 * scenarios file) of a JSON file holding an extraction or an
 * `ExtractionDocument`, whose `extraction` is used.
 */
export type ScenarioExtraction = string | Extraction
/** A comparator file (`<name>.comparator.yaml`) by path relative to the scenarios file, alone or as `{file, options}`; or the default comparator with options. */
export type ScenarioComparator = Static<typeof ScenarioComparatorSchema>
type ScenarioCommon = Omit<Static<typeof ScenarioSchema>, 'extraction' | 'before' | 'after' | 'comparator' | 'presentation'> & {
  presentation?: PresentationSettings
}
/** One authored renderer scenario: a single extraction, or before and after extractions. */
export type Scenario = ScenarioCommon &
  (
    | {extraction: ScenarioExtraction; before?: never; after?: never; comparator?: never}
    | {before: ScenarioExtraction; after: ScenarioExtraction; comparator?: ScenarioComparator; extraction?: never}
  )
/** A file of authored renderer scenarios, such as a renderer package's `scenarios.json`. */
export interface ScenariosDocument extends Omit<Static<typeof ScenariosDocumentSchema>, 'scenarios'> {
  scenarios: Scenario[]
}

/**
 * The revision an extraction examined: a `commit`, or the `working-tree` over its base commit, with the `ref` the user
 * named, the resolved `commit` (a 40- or 64-digit hex SHA) and whether the tree was `dirty`, which a commit never is.
 */
export interface Revision extends Static<typeof RevisionSchema> {}
/** The document an extractor receives on stdin. */
export interface ExtractorRequest extends Omit<Static<typeof ExtractorRequestSchema>, 'projection' | 'repository'> {
  projection: {id: string; definition: Definition}
  repository: Omit<Static<typeof ExtractorRequestSchema>['repository'], 'revision'> & {revision: Revision}
}
/**
 * What the runner records about how a saved extraction was made; extractors never write it. It holds the revision,
 * extractor, definition and its `definitionDigest`, reproducibility and limitations and, for an extractor the runner
 * ran, the `execution` that observed it. Its claims never grant trust.
 */
export interface Provenance extends Omit<Static<typeof ProvenanceSchema>, 'revision' | 'definition'> {
  revision: Revision
  definition: Definition
}
/**
 * A saved extraction (`format: "projections.extraction"`): the projection's identity, the normalized extraction, the
 * runner's provenance and `digest`, the lowercase SHA-256 of the canonical extraction bytes. `loadArtifact` verifies
 * one.
 */
export interface ExtractionDocument extends Omit<Static<typeof ExtractionDocumentSchema>, 'projection' | 'extraction' | 'provenance'> {
  projection: {id: string; title: string; renderer: string | RendererBundle}
  extraction: Extraction
  provenance: Provenance
}
/** What a pull request's or a push's CI run extracted or compared. */
export type ArtifactSubject = Static<typeof ArtifactSubjectSchema>
/**
 * One projection in a CI artifact manifest: a `changed` or `unchanged` comparison, an `extracted` push extraction or
 * a `head-only` or `base-only` extraction, at `path` with the SHA-256 of its file's bytes; or an `error`, with no
 * document and up to 20 diagnostics.
 */
export type ArtifactProjection = Static<typeof ArtifactProjectionSchema>
/**
 * `projections.artifact.json`, the manifest at the root of the `projections`
 * Actions artifact the GitHub Action uploads. Each document's full-byte SHA-256
 * is recorded; hosted views verify it, the documents and every SHA against GitHub.
 */
export interface ArtifactManifest extends Omit<Static<typeof ArtifactManifestSchema>, 'subject' | 'projections'> {
  subject: ArtifactSubject
  projections: ArtifactProjection[]
}
/**
 * A saved comparison (`format: "projections.comparison"`): both saved extractions, the comparison between them, the
 * comparator that produced it (`default` or a comparator file's path, with its `sha256:` digest) and informational
 * notices. `loadArtifact` verifies one by rerunning its comparator.
 */
export interface ComparisonDocument extends Omit<Static<typeof ComparisonDocumentSchema>, 'before' | 'after' | 'comparison'> {
  before: ExtractionDocument
  after: ExtractionDocument
  comparison: Comparison
}

/** An extraction's canonical form, which `ProjectionEngine.canonicalize` returns. */
export interface CanonicalExtraction {
  /**
   * The RFC 8785 serialization of its semantic content: IDs, kinds, labels, data, confidence, endpoints and `volatile`
   * declarations, without evidence, previous IDs or metadata, items in UTF-16 ID order.
   */
  canonical: string
  /** Lowercase hex SHA-256 of `canonical`'s UTF-8 bytes, with no prefix: an extraction's identity, not a file hash. */
  digest: string
}

/**
 * How two extractions of the same revision differ, item by item by ID: a rerun check. They are reproducible
 * when `beyond` is empty; `equal` says whether their canonical bytes are identical.
 */
export interface Variation {
  equal: boolean
  /** Volatile values that differ within their declared tolerance. */
  within: {collection: 'entities' | 'relationships'; id: string; path: string}[]
  /**
   * Everything else that differs: volatile values beyond tolerance, other fields (`/label`, `/data/<key>`),
   * items in one run only (an empty path) and, without a collection or ID, `/schema`, `/vocabularies` or
   * `/volatile`.
   */
  beyond: {collection?: 'entities' | 'relationships'; id?: string; path: string; reason: string}[]
}

/**
 * One request to the engine, as every transport sends it as JSON: version `0` and one `operation` with its inputs.
 * `ProjectionEngine` builds them; call it rather than a transport directly.
 */
export type EngineRequest =
  | {version: 0; operation: 'normalize'; extraction: unknown}
  | {version: 0; operation: 'canonicalize'; extraction: unknown}
  | {version: 0; operation: 'validate-comparison'; before: unknown; after: unknown; comparison: unknown}
  | {version: 0; operation: 'vary'; before: unknown; after: unknown}
  | {version: 0; operation: 'decode'; json: string}
  | {version: 0; operation: 'parse-json'; json: string}

/** The engine's reply to one request: the operation's `result`, or at least one error diagnostic. */
export type EngineResponse =
  | {ok: true; result: Extraction | CanonicalExtraction | Comparison | Variation | Json}
  | {ok: false; diagnostics: Diagnostic[]}

/**
 * The engine: the one Rust implementation of normalization, validation, canonicalization and comparison, whichever
 * transport runs it (the engine workspace's `createNativeEngine`, `createWasmEngine` or `createWorkerEngine`). Every
 * method rejects with an `EngineError` carrying diagnostics when the input is invalid, and with an
 * `EngineTransportError` when the engine could not run.
 */
export interface ProjectionEngine {
  /**
   * Parses a whole saved document's raw JSON strictly, rejecting duplicate keys, unpaired surrogates and unsafe
   * numbers, within 64 levels and 32 MiB. Returns generic JSON, not a validated artifact.
   */
  parseJson(json: string): Promise<Json>
  /**
   * Validates an extraction value against its domain schema and vocabularies, then sorts its items by ID and fills
   * omitted `data` with `{}`. Rejects host values that are not plain JSON.
   */
  normalize(extraction: unknown): Promise<Extraction>
  /**
   * Parses and normalizes an extractor's raw JSON output. Prefer it to `JSON.parse` and `normalize`, which can't see
   * duplicate keys or an integer already rounded.
   */
  decode(json: string): Promise<Extraction>
  /** Normalizes an extraction and returns its canonical bytes and digest. */
  canonicalize(extraction: unknown): Promise<CanonicalExtraction>
  /** Validates a comparison against both extractions and returns it normalized. */
  validateComparison(before: unknown, after: unknown, comparison: unknown): Promise<Comparison>
  /** Compares two extractions of the same revision by ID: what varied within and beyond its declared tolerance. */
  vary(before: unknown, after: unknown): Promise<Variation>
  /** Runs the default comparator module and validates its result. */
  compare(before: unknown, after: unknown, options?: DefaultComparatorOptions): Promise<Comparison>
  /** Identity of the default comparator module this engine runs. */
  defaultComparator(): Promise<{id: 'default'; digest: string}>
}

/**
 * Human-readable protocol text (comparison and step summaries, notices,
 * diagnostics, and comparator or extractor messages such as compatibility
 * reasons) marks inline code with backticks: `` Parameter `currency` was renamed ``.
 * A backslash escapes a literal backtick or backslash (`` \` ``, `\\`); any
 * other backslash is literal. An unclosed backtick is literal text.
 */

/** A run of prose text: human language, or inline code. */
export interface ProseSpan {
  text: string
  code: boolean
}

/** Splits prose into its human-language and inline-code runs, unescaping both. */
export function proseSpans(text: string): ProseSpan[] {
  const spans: ProseSpan[] = []
  const push = (run: string, code: boolean) => {
    const last = spans.at(-1)
    if (!run && !code) return
    if (last && !last.code && !code) last.text += run
    else spans.push({text: run, code})
  }
  let current = ''
  let opening = -1
  let code = false
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!
    if (character === '\\' && (text[index + 1] === '`' || text[index + 1] === '\\')) {
      current += text[++index]
    } else if (character === '`') {
      if (code) {
        push(current, true)
        code = false
      } else {
        push(current, false)
        opening = index
        code = true
      }
      current = ''
    } else current += character
  }
  if (code) {
    // An unclosed backtick is literal: everything from it on is prose.
    push(
      `\`${proseSpans(text.slice(opening + 1).replaceAll('`', '\\`'))
        .map(span => span.text)
        .join('')}`,
      false,
    )
  } else push(current, false)
  return spans.filter(span => span.text !== '' || span.code)
}

/** Prose as plain text, without code markers: for titles, labels and assistive text. */
export function plainProse(text: string): string {
  return proseSpans(text)
    .map(span => span.text)
    .join('')
}

/** Plain `text` as prose, its backticks and backslashes escaped so none is read as markup. */
export function escapeProse(text: string): string {
  return text.replace(/[\\`]/g, character => `\\${character}`)
}

/** `text` as an inline code span, escaped. */
export function codeSpan(text: string): string {
  return `\`${escapeProse(text)}\``
}
