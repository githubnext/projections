import type {ResultStamp, Staleness} from '../staleness.ts'

/** Badges in the order a pair shows them: the one that most qualifies the result wins. */
const badgeOrder = ['Stale', 'Approximate', 'Observed', 'Imported', 'From CI', 'Local']

/**
 * The badge a result earns beside its choice, from its sides' `provenance.execution` through `badge`
 * (`environment-model.ts`'s `provenanceBadge`, so the side bar, tabs and the environment view agree): the one that
 * most qualifies it (Stale, then Approximate, Observed, Imported, From CI, Local), with each side's detail.
 */
export function resultBadge(
  stamp: ResultStamp,
  badge: (document: unknown) => {label: string; detail: string} | undefined,
): {label: string; detail: string} | undefined {
  const found = stamp.sides.flatMap(side => {
    const earned = side.execution ? badge({provenance: {execution: side.execution}}) : undefined
    return earned ? [{side, earned}] : []
  })
  if (!found.length) return undefined
  const rank = (label: string) => (badgeOrder.includes(label) ? badgeOrder.indexOf(label) : badgeOrder.length)
  const strongest = found.reduce((best, item) => (rank(item.earned.label) < rank(best.earned.label) ? item : best))
  const named = (ref: string) => (ref === stamp.pair.before ? 'Before' : 'After')
  return {
    label: strongest.earned.label,
    detail: found.length === 1 ? found[0]!.earned.detail : found.map(item => `${named(item.side.ref)}: ${item.earned.detail}`).join('\n'),
  }
}

/** The tree to count "N files changed" from: a working-tree side's own, else the one stamped with the result. */
export function stampTree(stamp: ResultStamp): string | undefined {
  return stamp.sides.find(side => side.ref === 'working-tree')?.execution?.tree ?? stamp.tree
}

/**
 * The out-of-date notice's parts: `Out of date` and `3 files changed`, without a detail when no count is known (or none
 * changed: the definition did). The detail truncates first on a narrow stage.
 */
export function staleNotice(files: number | undefined): {label: string; detail?: string} {
  return files !== undefined && files !== 0
    ? {label: 'Out of date', detail: `${files} file${files === 1 ? '' : 's'} changed`}
    : {label: 'Out of date'}
}

/** `Out of date · 3 files changed`, or `Out of date` alone (`staleNotice`). */
export function staleText(files: number | undefined): string {
  const {label, detail} = staleNotice(files)
  return detail ? `${label} · ${detail}` : label
}

/** Why, as a sentence for a tooltip. */
export function staleTitle(staleness: Staleness): string {
  const titles: Record<Staleness['why'], string> = {
    'working tree': 'The working tree changed since this result',
    definition: "The projection's definition changed since this result",
    extractor: "The projection's extractor changed since this result",
    comparator: "The projection's comparator changed since this comparison",
    'refs moved': 'The revisions it compares moved (a commit, checkout or rebase) since this result',
    'changed while extracting': 'The working tree changed while this result was extracted',
  }
  return titles[staleness.why]
}
