import {customComparator} from '@githubnext/projections-schemas'
import type {
  DefaultComparatorOptions,
  Comparison,
  Definition,
  DefinitionPairing,
  Extraction,
  ExtractionDocument,
  ProjectionEngine,
} from '@githubnext/projections-schemas'

/**
 * Where the comparator for a projection comes from: the default comparator,
 * or a custom comparator file's bytes, run by the rules interpreter.
 */
export type ComparatorSource = {kind: 'default'} | {kind: 'rules'; id: string; bytes: Uint8Array; digest: string}

/**
 * Checks and runs comparator files in a sandbox, e.g. `createRulesRuntime()` from
 * `@githubnext/projections-comparator-runtime/browser`. `check` returns the
 * comparator digest of the file (and throws for an invalid one); `compare`
 * runs one comparison.
 */
export interface RulesRuntime {
  check: (rules: Uint8Array) => Promise<{digest: string}>
  compare: (rules: Uint8Array, input: unknown) => Promise<unknown>
}

/**
 * A validated comparison and the comparator that produced it: the default comparator's, or a custom comparator
 * file's ID (its path) and the digest of the content that ran.
 */
export interface ComputedComparison {
  comparison: Comparison
  comparator: {id: string; digest: string}
}

/**
 * Why a comparison failed: the extractions belong to different projections (`projection-mismatch`) or were produced by
 * different definitions (`definition-mismatch`, with what differs in `details`); the comparator the definition declares
 * can't run here (`comparator-unavailable`); a comparator file's content doesn't match its recorded digest
 * (`comparator-digest-mismatch`); the comparator is invalid or threw (`comparator-failed`); or a custom comparator's
 * result failed the engine's validation (`invalid-comparison`, with each diagnostic in `details`).
 */
export type ComparisonErrorCode =
  | 'projection-mismatch'
  | 'definition-mismatch'
  | 'comparator-unavailable'
  | 'comparator-digest-mismatch'
  | 'comparator-failed'
  | 'invalid-comparison'

/** An explicit comparison failure. Hosts show it; they never substitute another comparison. */
export class ComparisonError extends Error {
  readonly code: ComparisonErrorCode
  readonly details: string[]

  constructor(code: ComparisonErrorCode, message: string, details: string[] = []) {
    super(message)
    this.code = code
    this.details = details
    this.name = 'ComparisonError'
  }
}

const definitionParts: Record<keyof Definition, string> = {
  id: 'projection ID',
  title: 'title',
  description: 'description',
  extractor: 'extractor',
  comparator: 'comparator',
  renderer: 'renderer',
  inputs: 'inputs',
  correspondence: 'declared correspondence',
  execution: 'execution settings',
  presentation: 'presentation defaults',
}

/**
 * Explains why two extractions can't be compared as one definition's (`ProjectionEngine.pair`): which parts of their
 * definitions differ or, when the definitions agree, that the content of their declared component sources does.
 */
export function explainDefinitionMismatch(pairing: Exclude<DefinitionPairing, {pairing: 'same' | 'projection'}>): string[] {
  if (pairing.pairing === 'components') {
    return ['The definitions are identical, so the content of their declared component sources differs.']
  }
  return pairing.differing.map(key => `The ${definitionParts[key as keyof Definition] ?? key} differs.`)
}

/** Lowercase hex SHA-256 of bytes, as `sha256:<hex>`. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Compares two saved extractions in the browser.
 *
 * Both must come from one projection definition, as the engine decides (`ProjectionEngine.pair`).
 * The definition's comparator decides how: the default comparator runs
 * through the engine with the definition's options; a custom comparator runs
 * in the supplied rules runtime's sandbox, and the engine validates its
 * result against both extractions. Every failure throws `ComparisonError`.
 */
export async function computeComparison({
  engine,
  before,
  after,
  comparator,
  rules,
}: {
  engine: ProjectionEngine
  before: ExtractionDocument
  after: ExtractionDocument
  comparator: ComparatorSource
  rules?: RulesRuntime
}): Promise<ComputedComparison> {
  const pairing = await engine.pair(before, after)
  if (pairing.pairing === 'projection') {
    throw new ComparisonError(
      'projection-mismatch',
      `These extractions belong to different projections (${before.projection.id} and ${after.projection.id}).`,
    )
  }
  if (pairing.pairing !== 'same') {
    throw new ComparisonError(
      'definition-mismatch',
      'These extractions were produced by different versions of the projection definition, so comparing them would mix code changes with projection changes. Extract both revisions with the same definition.',
      explainDefinitionMismatch(pairing),
    )
  }
  const declared = before.provenance.definition.comparator
  const custom = customComparator(declared)
  if (custom) {
    if (comparator.kind !== 'rules') {
      throw new ComparisonError(
        'comparator-unavailable',
        `The definition uses the custom comparator ${custom.file}, which is not available here.`,
      )
    }
    return compareExtractions({
      engine,
      before: before.extraction,
      after: after.extraction,
      rules,
      comparator: {kind: 'rules', id: custom.file, bytes: comparator.bytes, digest: comparator.digest, options: custom.options ?? {}},
    })
  }
  if (comparator.kind !== 'default') {
    throw new ComparisonError('comparator-unavailable', 'The definition uses the default comparator, but a custom comparator was supplied.')
  }
  return compareExtractions({
    engine,
    before: before.extraction,
    after: after.extraction,
    comparator: {kind: 'default', options: (typeof declared === 'object' && !('file' in declared) && declared.options) || {}},
  })
}

/**
 * Compares two extractions with a comparator, without definition checks: the
 * default comparator with its options, or a comparator file run in the
 * supplied rules runtime, which checks it, identifies it by digest and computes
 * the default baseline itself; the engine validates the comparator's result
 * against both extractions. When `digest` is given, the file's digest must match it.
 * Every failure throws `ComparisonError`.
 */
export async function compareExtractions({
  engine,
  before,
  after,
  comparator,
  rules,
}: {
  engine: ProjectionEngine
  before: Extraction
  after: Extraction
  comparator:
    | {kind: 'default'; options?: DefaultComparatorOptions}
    | {kind: 'rules'; id: string; bytes: Uint8Array; digest?: string; options?: unknown}
  rules?: RulesRuntime | undefined
}): Promise<ComputedComparison> {
  if (comparator.kind === 'default') {
    try {
      return {comparison: await engine.compare(before, after, comparator.options ?? {}), comparator: await engine.defaultComparator()}
    } catch (error) {
      throw new ComparisonError('comparator-failed', `The default comparator failed: ${errorMessage(error)}`)
    }
  }
  if (!rules) throw new ComparisonError('comparator-unavailable', 'This host cannot run custom comparators.')
  let digest: string
  try {
    ;({digest} = await rules.check(comparator.bytes))
  } catch (error) {
    throw new ComparisonError('comparator-failed', `The comparator file ${comparator.id} is invalid: ${errorMessage(error)}`)
  }
  if (comparator.digest !== undefined && digest !== comparator.digest) {
    throw new ComparisonError(
      'comparator-digest-mismatch',
      `The comparator file's content (${digest}) does not match its recorded digest (${comparator.digest}).`,
    )
  }
  let output: unknown
  try {
    // The rules interpreter computes the default baseline itself.
    output = await rules.compare(comparator.bytes, {
      protocolVersion: 0,
      before,
      after,
      baseline: {},
      options: comparator.options ?? {},
    })
  } catch (error) {
    throw new ComparisonError('comparator-failed', `The custom comparator ${comparator.id} failed: ${errorMessage(error)}`)
  }
  return validated(engine, before, after, output, {id: comparator.id, digest}, `The custom comparator ${comparator.id}`)
}

async function validated(
  engine: ProjectionEngine,
  before: Extraction,
  after: Extraction,
  output: unknown,
  comparator: {id: string; digest: string},
  name: string,
): Promise<ComputedComparison> {
  try {
    return {comparison: await engine.validateComparison(before, after, output), comparator}
  } catch (error) {
    const diagnostics = (error as {diagnostics?: {path: string; message: string}[]}).diagnostics
    throw new ComparisonError(
      'invalid-comparison',
      `${name} produced an invalid comparison: ${errorMessage(error)}`,
      diagnostics?.map(item => `${item.path}: ${item.message}`) ?? [],
    )
  }
}
