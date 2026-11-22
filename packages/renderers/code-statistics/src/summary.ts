import {codeStatisticsOptions, humanizeKind, summaryChange} from '@githubnext/projections-renderer-kit'
import type {SummaryFactContext, SummaryFactItem, SummaryNoun, SummaryNouns} from '@githubnext/projections-renderer-kit'
import {genericMetrics, sharedUnit, statisticsCount} from '@githubnext/projections-renderer-sdk/presentation'
import type {CodeStatisticsMeasure, CodeStatisticsScope} from '@githubnext/projections-renderer-sdk/presentation'
import type {Entity} from '@githubnext/projections-schemas'

/** The summary bar's words: every row is a language. */
export const codeStatisticsNouns: SummaryNouns = {language: {singular: 'language', plural: 'languages'}}

/** Each measure's noun, as the rows count it. */
const measureNouns: Record<CodeStatisticsMeasure, SummaryNoun> = {
  code: {singular: 'line of code', plural: 'lines of code'},
  comment: {singular: 'comment line', plural: 'comment lines'},
  blank: {singular: 'blank line', plural: 'blank lines'},
  lines: {singular: 'line', plural: 'lines'},
  files: {singular: 'file', plural: 'files'},
}

/** The code, comment and blank lines a composition adds up: every line, once. */
const composition: readonly CodeStatisticsMeasure[] = ['code', 'comment', 'blank']

const scoped = (noun: SummaryNoun, scope: CodeStatisticsScope): SummaryNoun =>
  scope === 'all'
    ? noun
    : {
        singular: `${noun.singular} ${scope === 'tests' ? 'in' : 'outside'} tests`,
        plural: `${noun.plural} ${scope === 'tests' ? 'in' : 'outside'} tests`,
      }

/**
 * The summary bar's total: what the rows add up to in the Measure and Files controls (every line, by language
 * composition), in After, with its net change since Before in a comparison (`39,882 lines of code +2,056`).
 */
export function codeStatisticsFacts({init, model, controls}: SummaryFactContext): SummaryFactItem[] {
  const entities = model.entities.flatMap(row => [row.before as Entity | undefined, row.after as Entity | undefined])
  if (genericMetrics(entities)) return metricFacts(init, model, entities)
  const {measure, byLanguage, scope} = codeStatisticsOptions(controls)
  const parts = byLanguage ? [measure] : composition
  const total = (side: 'before' | 'after') =>
    model.entities.reduce(
      (sum, row) => sum + parts.reduce((part, key) => part + (statisticsCount(row[side] as Entity | undefined, key, scope) ?? 0), 0),
      0,
    )
  const now = total('after')
  return [
    {
      type: 'fact',
      id: 'total',
      count: Math.round(now),
      noun: scoped(byLanguage ? measureNouns[measure] : measureNouns.lines, scope),
      ...summaryChange(init.mode === 'comparison' ? Math.round(total('before')) : undefined, Math.round(now)),
    },
  ]
}

/**
 * Generic measurements' total, when every row shares a unit (`35 methods +4`); rows in different units, or none,
 * don't add up, so they state no total.
 */
function metricFacts(
  init: SummaryFactContext['init'],
  model: SummaryFactContext['model'],
  entities: readonly (Entity | undefined)[],
): SummaryFactItem[] {
  const unit = sharedUnit(entities)
  if (!unit) return []
  const total = (side: 'before' | 'after') =>
    model.entities.reduce((sum, row) => sum + (statisticsCount(row[side] as Entity | undefined, 'value') ?? 0), 0)
  const now = total('after')
  return [
    {
      type: 'fact',
      id: 'total',
      count: Math.round(now),
      noun: unitNoun(unit),
      ...summaryChange(init.mode === 'comparison' ? Math.round(total('before')) : undefined, Math.round(now)),
    },
  ]
}

/** A unit as a noun: a word's singular for one (`methods` → `1 method`); a short symbol (`ms`) as it is. */
export function unitNoun(unit: string): SummaryNoun {
  const words = humanizeKind(unit)
  return /^[A-Za-z]{1,3}$/u.test(unit) || !words.singular ? {singular: unit, plural: unit} : {singular: words.singular, plural: unit}
}
