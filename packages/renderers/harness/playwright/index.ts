import type {Page} from '@playwright/test'
import type {
  DefaultComparatorOptions,
  Comparison,
  Entity,
  Extraction,
  ProjectionEngine,
  Relationship,
} from '@githubnext/projections-schemas'
import {connectInspector, openStage, samples} from '@githubnext/projections-renderer-testing/playwright'
import type {OpenRequest as StageRequest, StageHandle} from '@githubnext/projections-renderer-testing/playwright'

export {samples}
export type {
  StageEnvironment as HarnessEnvironment,
  StageLoad as HarnessLoad,
  StageSeek as HarnessSeek,
  StageState as HarnessState,
  StageSubject as HarnessSubject,
} from '@githubnext/projections-renderer-testing/playwright'
/** A built-in renderer presented on the harness stage: the testing package's `StageHandle`. */
export type RendererHandle = StageHandle
/** What the harness presents: the testing package's `OpenRequest`. */
export type OpenRequest = StageRequest

let engine: Promise<ProjectionEngine> | undefined
/** The real default comparator (native engine), so tests see the steps a host would send. */
export async function compare(before: Extraction, after: Extraction, options?: DefaultComparatorOptions): Promise<Comparison> {
  engine ??= import('@githubnext/projections-engine/native').then(module => module.createNativeEngine())
  return (await engine).compare(before, after, options)
}

/**
 * Compares with a custom comparator module, as hosts do: the module receives the
 * default baseline and `options`, and the Engine validates its output.
 */
export async function compareWithComparator(
  before: Extraction,
  after: Extraction,
  rules: string | URL,
  options?: unknown,
): Promise<Comparison> {
  engine ??= import('@githubnext/projections-engine/native').then(module => module.createNativeEngine())
  const {compareWithRules} = await import('../scripts/comparators.mjs')
  return compareWithRules(await engine, before, after, rules, options)
}
export {priorityOrderRules} from '../scripts/comparators.mjs'

/** An extraction (protocol version 0) of `schema` from the given items, for a test to present or compare. */
export function extraction(
  schema: Extraction['schema'],
  entities: Entity[],
  relationships: Relationship[] = [],
  metadata?: Extraction['metadata'],
): Extraction {
  return {protocolVersion: 0, schema, entities, relationships, ...(metadata ? {metadata} : {})}
}

/** The Inspector the harness's global setup started in fixtures mode over every built-in renderer. */
export function harnessInspector() {
  const url = process.env.PROJECTIONS_HARNESS_URL
  if (!url) throw new Error('PROJECTIONS_HARNESS_URL is not set; run through the harness Playwright config')
  return connectInspector(url)
}

/**
 * Opens the Inspector's stage page, resolves `renderer` against the served
 * bundles exactly as hosts do, and presents an extraction or a comparison
 * (computed with the native default comparator unless supplied). Resolves
 * after the renderer is ready and has painted the initial progress.
 */
export async function openRenderer(page: Page, request: OpenRequest): Promise<RendererHandle> {
  if ('before' in request && !request.comparison) {
    const {comparatorOptions, ...rest} = request
    return openStage(page, harnessInspector(), {...rest, comparison: await compare(request.before, request.after, comparatorOptions)})
  }
  return openStage(page, harnessInspector(), request)
}
