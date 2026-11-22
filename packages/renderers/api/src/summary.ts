import {plainProse} from '@githubnext/projections-schemas'
import type {SummaryFactContext, SummaryFactItem, SummaryNoun, SummaryNouns} from '@githubnext/projections-renderer-kit'
import {compatibilityLabels, compatibilityLevels, compatibilityOf, type CompatibilityLevel} from './compatibility.js'

const declaration: SummaryNoun = {singular: 'declaration', plural: 'declarations'}

/**
 * The summary bar's words: every exported declaration, whatever its kind, is a declaration, one figure as the list
 * shows them. Containment is the nesting the outline shows, so no relationship is a figure.
 */
export const apiNouns: SummaryNouns = (_kind, collection) => (collection === 'entities' ? declaration : false)

/** Each compatibility level as the summary bar counts it. */
const levelNouns: Record<CompatibilityLevel, SummaryNoun> = {
  breaking: {singular: 'breaking change', plural: 'breaking changes'},
  unknown: {singular: 'change of unknown compatibility', plural: 'changes of unknown compatibility'},
  additive: {singular: 'additive change', plural: 'additive changes'},
  compatible: {singular: 'compatible change', plural: 'compatible changes'},
}

/**
 * The summary bar's compatibility facts, when the api-compatibility comparator classified the comparison: how many
 * changes break consumers, couldn't be classified, add to the API or keep it compatible, breaking first, each with its
 * level's icon, filtering to its changes, and naming the rules that classified them.
 */
export function apiFacts({init}: SummaryFactContext): SummaryFactItem[] {
  if (init.mode !== 'comparison') return []
  const compatibility = compatibilityOf(init.comparison.metadata)
  if (!compatibility) return []
  const description = compatibility.rules ? `Rules: ${plainProse(compatibility.rules)}` : undefined
  return compatibilityLevels
    .filter(level => compatibility.counts[level] > 0)
    .map(level => {
      const ids = [...compatibility.changes].filter(([, classified]) => classified.level === level).map(([id]) => id)
      return {
        type: 'fact' as const,
        id: level,
        icon: compatibilityLabels[level].icon,
        count: compatibility.counts[level],
        noun: levelNouns[level],
        ...(ids.length ? {ids} : {}),
        ...(description ? {description} : {}),
      }
    })
}
