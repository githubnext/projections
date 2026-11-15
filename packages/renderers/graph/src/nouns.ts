import type {SummaryNouns} from '@githubnext/projections-renderer-kit'

/**
 * The summary bar's nouns for kinds the host can't word from their names: a DAG's `precedes` relationship is a verb,
 * so it counts as a dependency (`2 dependencies`), as a job that needs another depends on it. Every other kind keeps
 * the host's words and order.
 */
export const graphNouns: SummaryNouns = (kind, collection) =>
  collection === 'relationships' && kind === 'precedes' ? {singular: 'dependency', plural: 'dependencies'} : undefined
