import {
  customComparator,
  type ComparisonDocument,
  type Definition,
  type Diagnostic,
  type ExtractionDocument,
  type ProjectionEngine,
} from '@githubnext/projections-schemas'
import {validateComparisonDocument, validateExtractionDocument, type SchemaValidator} from './validators.js'

/** A saved artifact `loadArtifact` has verified: an extraction or a comparison, told apart by `format`. */
export type ArtifactDocument = ExtractionDocument | ComparisonDocument
/** The largest raw artifact `loadArtifact` accepts, in UTF-8 bytes: 32 MiB, as `limits.artifactBytes`. */
export const maxArtifactBytes = 32 * 1024 * 1024

/**
 * Why `loadArtifact` rejected a saved artifact: oversized or non-string input (`ARTIFACT_SIZE`, `ARTIFACT_INPUT`), an
 * unknown format or invalid envelope (`ARTIFACT_FORMAT`, `ARTIFACT_SCHEMA`), provenance or a digest that does not
 * match (`ARTIFACT_PROVENANCE`, `ARTIFACT_DIGEST`), or a comparison its comparator does not reproduce
 * (`ARTIFACT_PROJECTION`, `ARTIFACT_DEFINITION`, `ARTIFACT_COMPARATOR`, `ARTIFACT_RULES`, `ARTIFACT_COMPARISON`).
 * Engine failures are rethrown as their own `EngineError` instead.
 */
export class ArtifactError extends Error {
  /** One error diagnostic: the code above, the JSON Pointer `path` into the artifact and the message. */
  readonly diagnostics: readonly Diagnostic[]

  constructor(code: string, path: string, message: string) {
    super(message)
    this.name = 'ArtifactError'
    this.diagnostics = [{severity: 'error', code, path, message}]
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((value, index) => sameJson(value, right[index]))
  }
  if (!isObject(left) || !isObject(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]))
}

function assertSchema<T>(value: unknown, validate: SchemaValidator<T>): asserts value is T {
  if (validate(value)) return
  const issue = validate.errors?.[0]
  throw new ArtifactError(
    'ARTIFACT_SCHEMA',
    issue?.instanceLocation.replace(/^#/, '') ?? '',
    `Invalid artifact envelope (${issue?.keywordLocation ?? 'schema mismatch'})`,
  )
}

async function verifyExtraction(document: ExtractionDocument, engine: ProjectionEngine, prefix: string): Promise<ExtractionDocument> {
  const definition = document.provenance.definition
  if (
    document.projection.id !== definition.id ||
    !sameJson(document.projection.renderer, definition.renderer) ||
    document.projection.title !== (definition.title ?? definition.id)
  ) {
    throw new ArtifactError(
      'ARTIFACT_PROVENANCE',
      `${prefix}/projection`,
      'Projection identity, title and renderer must match the recorded definition',
    )
  }
  const extractor = typeof definition.extractor === 'string' ? definition.extractor : 'executable'
  if (document.provenance.extractor.id !== extractor) {
    throw new ArtifactError(
      'ARTIFACT_PROVENANCE',
      `${prefix}/provenance/extractor/id`,
      'Extractor provenance must match the recorded definition',
    )
  }
  const extraction = await engine.normalize(document.extraction)
  const canonical = await engine.canonicalize(extraction)
  if (canonical.digest !== document.digest) {
    throw new ArtifactError('ARTIFACT_DIGEST', `${prefix}/digest`, 'Extraction digest does not match its content')
  }
  return {...document, extraction}
}

/**
 * Checks and runs custom comparators (comparator files) in a sandbox, e.g. `createRulesRuntime()` or
 * `createNativeRulesRuntime()` from `@githubnext/projections-comparator-runtime`.
 */
export interface ArtifactRulesRuntime {
  check(rules: Uint8Array, options?: {signal?: AbortSignal}): Promise<{digest: string}>
  compare(rules: Uint8Array, input: unknown, options?: {signal?: AbortSignal}): Promise<unknown>
}

/**
 * The comparator file a saved comparison's definition names, from a source the
 * caller trusts (for example the repository at the definition's revision),
 * and the runtime that reruns it.
 */
export interface ArtifactRules {
  bytes: Uint8Array
  runtime: ArtifactRulesRuntime
  /** Cancels the rerun: the runtime stops its worker or process, and loading fails. */
  signal?: AbortSignal
}

async function verifyComparison(value: ComparisonDocument, engine: ProjectionEngine, rules?: ArtifactRules): Promise<ComparisonDocument> {
  // One definition, with one version of its component code, explains both revisions (the engine decides).
  const {pairing} = await engine.pair(value.before, value.after)
  if (pairing === 'projection') {
    throw new ArtifactError('ARTIFACT_PROJECTION', '/after/projection/id', 'A comparison must describe the same projection')
  }
  if (pairing !== 'same') {
    throw new ArtifactError(
      'ARTIFACT_DEFINITION',
      '/after/provenance/definitionDigest',
      'Compared extractions must come from the same projection definition and component code',
    )
  }
  const before = await verifyExtraction(value.before, engine, '/before')
  const after = await verifyExtraction(value.after, engine, '/after')
  const comparator = before.provenance.definition.comparator
  const custom = customComparator(comparator)
  if (custom && rules) return rerunCustom(value, engine, [before, after], custom, rules)
  if (custom || value.comparator.id !== 'default') {
    throw new ArtifactError(
      'ARTIFACT_COMPARATOR',
      '/comparator/id',
      'This comparison names a custom comparator: verifying it needs its comparator file (`rules`)',
    )
  }
  return rerunDefault(value, engine, [before, after], comparator)
}

/** Verifies a comparison by its comparator file: the file must be the one that produced it, and rerunning it must reproduce it. */
async function rerunCustom(
  value: ComparisonDocument,
  engine: ProjectionEngine,
  [before, after]: [ExtractionDocument, ExtractionDocument],
  custom: NonNullable<ReturnType<typeof customComparator>>,
  rules: ArtifactRules,
): Promise<ComparisonDocument> {
  if (value.comparator.id !== custom.file) {
    throw new ArtifactError(
      'ARTIFACT_COMPARATOR',
      '/comparator/id',
      `The comparison names ${value.comparator.id}, but its definition uses the comparator file ${custom.file}`,
    )
  }
  // The file supplied must be the comparator file that produced the comparison: its digest covers its meaning and the interpreter.
  let digest: string
  try {
    ;({digest} = await rules.runtime.check(rules.bytes, rules.signal ? {signal: rules.signal} : {}))
  } catch (error) {
    throw new ArtifactError(
      'ARTIFACT_RULES',
      '/comparator',
      `The comparator file ${custom.file} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (digest !== value.comparator.digest) {
    throw new ArtifactError(
      'ARTIFACT_COMPARATOR',
      '/comparator/digest',
      `The comparison was produced by another comparator than ${custom.file} (${digest})`,
    )
  }
  let output: unknown
  try {
    output = await rules.runtime.compare(
      rules.bytes,
      {protocolVersion: 0, before: before.extraction, after: after.extraction, baseline: {}, options: custom.options ?? {}},
      rules.signal ? {signal: rules.signal} : {},
    )
  } catch (error) {
    throw new ArtifactError(
      'ARTIFACT_RULES',
      '/comparator',
      `The comparator file ${custom.file} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const comparison = await engine.validateComparison(before.extraction, after.extraction, output)
  if (!sameJson(value.comparison, comparison)) {
    throw new ArtifactError('ARTIFACT_COMPARISON', '/comparison', 'Saved comparison does not match the comparator result')
  }
  return {...value, before, after, comparison}
}

/** Verifies a comparison by the default comparator: the same build, rerun, must reproduce it. */
async function rerunDefault(
  value: ComparisonDocument,
  engine: ProjectionEngine,
  [before, after]: [ExtractionDocument, ExtractionDocument],
  comparator: Definition['comparator'],
): Promise<ComparisonDocument> {
  const defaultComparatorOptions = typeof comparator === 'object' ? comparator.options : undefined
  const defaultComparator = await engine.defaultComparator()
  if (value.comparator.digest !== defaultComparator.digest) {
    throw new ArtifactError(
      'ARTIFACT_COMPARATOR',
      '/comparator/digest',
      'The comparison was produced by a different build of the default comparator; compare the extractions again',
    )
  }
  // Comparators are deterministic: rerun rather than trust the saved claims.
  const comparison = await engine.compare(before.extraction, after.extraction, defaultComparatorOptions ?? {})
  if (!sameJson(value.comparison, comparison)) {
    throw new ArtifactError('ARTIFACT_COMPARISON', '/comparison', 'Saved comparison does not match the comparator result')
  }
  return {...value, before, after, comparison}
}

/**
 * Loads and verifies a saved extraction or comparison. A comparison made by a
 * custom comparator is verified only with `rules`: the comparator file its
 * definition names, which must have the comparison's comparator digest, and a
 * runtime to rerun it.
 *
 * Verification is not authentication: evidence and provenance remain claims.
 *
 * @param json - The raw artifact JSON text, at most `maxArtifactBytes` of UTF-8.
 * @returns The verified artifact, with each extraction normalized.
 * @throws `ArtifactError` when the artifact fails a check, and `EngineError` when the engine rejects its JSON or an
 *   extraction.
 *
 * @example
 * ```ts
 * import {loadArtifact} from '@githubnext/projections-engine/artifacts'
 * import {createWasmEngine} from '@githubnext/projections-engine/browser'
 *
 * const artifact = await loadArtifact(await file.text(), {engine: await createWasmEngine()})
 * if (artifact.format === 'projections.comparison') show(artifact.comparison)
 * ```
 */
export async function loadArtifact(
  json: string,
  {engine, rules}: {engine: ProjectionEngine; rules?: ArtifactRules | undefined},
): Promise<ArtifactDocument> {
  if (typeof json !== 'string') {
    throw new ArtifactError('ARTIFACT_INPUT', '', 'Artifact input must be raw JSON text')
  }
  if (json.length > maxArtifactBytes || new TextEncoder().encode(json).byteLength > maxArtifactBytes) {
    throw new ArtifactError('ARTIFACT_SIZE', '', `Artifact exceeds ${maxArtifactBytes} UTF-8 bytes`)
  }
  const value = await engine.parseJson(json)
  if (!isObject(value)) throw new ArtifactError('ARTIFACT_FORMAT', '', 'Artifact must be an object')
  if (value.format === 'projections.extraction') {
    assertSchema(value, validateExtractionDocument)
    return verifyExtraction(value, engine, '')
  }
  if (value.format !== 'projections.comparison') {
    throw new ArtifactError('ARTIFACT_FORMAT', '/format', 'Unsupported artifact format')
  }
  assertSchema(value, validateComparisonDocument)
  return verifyComparison(value, engine, rules)
}
