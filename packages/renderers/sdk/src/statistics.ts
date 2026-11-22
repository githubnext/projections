// Code statistics and generic metrics: the counts a `metrics/v0` extraction keeps, scoped and aggregated for presentation.
import type {Entity} from '@githubnext/projections-schemas'
import type {PresentationFrame, Presented} from './presentation.js'
import type {Quantity} from './quantities.js'

/** Which code-statistics count to show: lines of code, comment lines, blank lines, all lines or files. */
export type CodeStatisticsMeasure = 'code' | 'comment' | 'blank' | 'lines' | 'files'
/** What a statistics row counts: a code-statistics measure, or a generic metric's `data.value` (see `hasCodeCounts`). */
export type StatisticsKey = CodeStatisticsMeasure | 'value'
/** Which files a count covers: every file, files the extractor classified as tests, or the rest. */
export type CodeStatisticsScope = 'all' | 'tests' | 'other'
/** How a code-statistics view measures and charts its counts (`ViewerState.statistics`, `statisticsRows`). */
export interface CodeStatisticsOptions {
  /** The count each language row shows; ignored without `byLanguage`, which always shows code, comments and blanks. */
  measure: CodeStatisticsMeasure
  /**
   * `bars` for absolute values, `share` for each row's share of the total (`quantityShares`), `table` for every count
   * in a sortable table.
   */
  chart: 'bars' | 'share' | 'table'
  /** One row per language, or `false` for the whole repository's code, comment and blank lines. */
  byLanguage: boolean
  /** Which files the counts cover. */
  scope: CodeStatisticsScope
}
/** Lines of code per language, as bars, over all files. */
export const defaultCodeStatisticsOptions: Readonly<CodeStatisticsOptions> = {
  measure: 'code',
  chart: 'bars',
  byLanguage: true,
  scope: 'all',
}
/** Every scope with its display label, in menu order. */
export const codeStatisticsScopes: readonly {id: CodeStatisticsScope; label: string}[] = [
  {id: 'all', label: 'All files'},
  {id: 'tests', label: 'Tests'},
  {id: 'other', label: 'Non-tests'},
]
/** Whether `value` is a `CodeStatisticsScope`, for validating a saved or declared option. */
export function isCodeStatisticsScope(value: unknown): value is CodeStatisticsScope {
  return value === 'all' || value === 'tests' || value === 'other'
}
const testKey = (key: StatisticsKey) => `test${key[0]!.toUpperCase()}${key.slice(1)}`
const count = (entity: Entity | undefined, key: string) => {
  const value = entity?.data?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * A language's count of `key` within `scope`. Test counts (`testFiles`,
 * `testCode`, `testComment`, `testBlank`, `testLines`) are a subset of the
 * totals, so `other` is the total minus the test count. Undefined when the
 * extraction has no such measurement.
 */
export function statisticsCount(entity: Entity | undefined, key: StatisticsKey, scope: CodeStatisticsScope = 'all'): number | undefined {
  const total = count(entity, key)
  if (scope === 'all') return total
  const tests = count(entity, testKey(key))
  if (scope === 'tests') return tests
  return total === undefined || tests === undefined ? undefined : Math.max(0, total - tests)
}

/**
 * Whether any of these entities carries line or file counts (`data.code`, `lines` or `files`), as the
 * code-statistics extractor writes them. Without any, a `metrics/v0` extraction is a set of generic measurements:
 * each entity's `data.value`, in its `data.unit`.
 */
export function hasCodeCounts(entities: Iterable<Entity | undefined>): boolean {
  for (const entity of entities) {
    if (count(entity, 'code') !== undefined || count(entity, 'lines') !== undefined || count(entity, 'files') !== undefined) return true
  }
  return false
}

/** Whether these entities are generic measurements: some carry a numeric `data.value`, and none counts lines or files. */
export function genericMetrics(entities: Iterable<Entity | undefined>): boolean {
  const list = [...entities]
  return !hasCodeCounts(list) && list.some(entity => count(entity, 'value') !== undefined)
}

/** The unit every one of these entities' measurements shares (`data.unit`), or undefined when they differ or have none. */
export function sharedUnit(entities: Iterable<Entity | undefined>): string | undefined {
  const units = new Set<string>()
  for (const entity of entities) if (entity) units.add(typeof entity.data?.unit === 'string' ? entity.data.unit.trim() : '')
  const [unit] = units
  return units.size === 1 && unit ? unit : undefined
}

/** Whether any of these entities carries test counts, so a test/non-test split is meaningful. */
export function hasTestCounts(entities: Iterable<Entity | undefined>): boolean {
  for (const entity of entities) if (count(entity, 'testLines') !== undefined || count(entity, 'testFiles') !== undefined) return true
  return false
}
/** Every measure with its display label and the unit its rows carry, in menu order. */
export const codeStatisticsMeasures: readonly {id: CodeStatisticsMeasure; label: string; unit: string}[] = [
  {id: 'code', label: 'Code', unit: 'lines of code'},
  {id: 'comment', label: 'Comments', unit: 'comment lines'},
  {id: 'blank', label: 'Blank', unit: 'blank lines'},
  {id: 'lines', label: 'All lines', unit: 'lines'},
  {id: 'files', label: 'Files', unit: 'files'},
]
/** Whether `value` is a `CodeStatisticsMeasure`, for validating a saved or declared option. */
export function isCodeStatisticsMeasure(value: string): value is CodeStatisticsMeasure {
  return codeStatisticsMeasures.some(measure => measure.id === value)
}
/** One bar of a statistics chart, at the frame's progress (`statisticsRows`). */
export interface StatisticsRow extends Quantity {
  /** The language's row ID; without `byLanguage`, `composition:code`, `composition:comment` or `composition:blank`. */
  id: string
  /** The language's label (else its ID), or `Code`, `Comments` or `Blank`. */
  label: string
  /** The language's presence from its frame node; 1 for composition rows. */
  opacity: number
  /** The language's frame node; absent for composition rows. */
  node?: Presented<Entity>
}

/** A language's count at its own step (`node.local`), scoped; an arriving or leaving language scales with its presence. */
function countAt(node: Presented<Entity>, key: CodeStatisticsMeasure, scope: CodeStatisticsScope): number | undefined {
  const {before, after} = node.change
  const a = statisticsCount(before, key, scope),
    b = statisticsCount(after, key, scope)
  const value = !before ? b : !after ? a : a === undefined || b === undefined ? (node.local < 0.5 ? a : b) : a + (b - a) * node.local
  return value === undefined ? undefined : value * (!before || !after ? node.opacity : 1)
}

/** The total of `values`, or `undefined` when any is missing or the sum isn't finite: a partial total would mislead. */
export function sumQuantities(values: readonly (number | undefined)[]): number | undefined {
  let total = 0
  for (const value of values) {
    if (value === undefined) return undefined
    total += value
  }
  return Number.isFinite(total) ? total : undefined
}

/** Aggregates collected counts for presentation, each language at its own step (`local`) and in `options.scope`; never invents entity correspondence or change status. */
export function statisticsRows(frame: PresentationFrame, options: CodeStatisticsOptions): StatisticsRow[] {
  if (options.byLanguage) {
    const unit = codeStatisticsMeasures.find(measure => measure.id === options.measure)!.unit
    return frame.nodes.map(node => ({
      id: node.id,
      label: node.entity.label,
      unit,
      value: countAt(node, options.measure, options.scope),
      opacity: node.opacity,
      node,
    }))
  }
  return (['code', 'comment', 'blank'] as const).map(key => ({
    id: `composition:${key}`,
    label: key === 'code' ? 'Code' : key === 'comment' ? 'Comments' : 'Blank',
    unit: 'lines',
    opacity: 1,
    value: sumQuantities(frame.nodes.map(node => countAt(node, key, options.scope))),
  }))
}
