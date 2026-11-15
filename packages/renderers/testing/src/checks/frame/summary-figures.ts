// A summary's figures, checked against the documents: a count per kind, and the renderer's own facts.
import {summaryDeltas} from '@githubnext/projections-renderer-sdk/presentation'
import type {SummaryCount} from '@githubnext/projections-renderer-sdk/presentation'
import type {SummaryCountItem, SummaryFactItem} from '@githubnext/projections-renderer-sdk/protocol'
import type {StageSubject} from '../../types.js'

/** The IDs the documents have: their entities and relationships, and a comparison's changes. */
export function knownIds(subject: StageSubject): Set<string> {
  const documents = subject.mode === 'extraction' ? [subject.extraction] : [subject.before, subject.after]
  const known = new Set(documents.flatMap(document => [...document.entities, ...document.relationships].map(item => item.id)))
  if (subject.mode === 'comparison') for (const change of subject.comparison.changes) known.add(change.id)
  return known
}

/** A fact's count is the renderer's own finding; what it names must exist, and only a comparison has changes. */
export function factFailures(item: SummaryFactItem, subject: StageSubject, known: ReadonlySet<string>): string[] {
  const failures: string[] = []
  const missing = (item.ids ?? []).filter(id => !known.has(id))
  if (missing.length)
    failures.push(
      `The summary fact "${item.id}" names ${missing.length} item${missing.length === 1 ? '' : 's'} neither document has: ${missing.slice(0, 3).join(', ')}.`,
    )
  const changes = summaryDeltas.filter(delta => (item[delta] ?? 0) > 0)
  if (subject.mode === 'extraction' && changes.length)
    failures.push(`The summary fact "${item.id}" reports ${changes.join(' and ')} counts for one extraction, which has no changes.`)
  for (const delta of ['added', 'modified'] as const)
    if ((item[delta] ?? 0) > item.count)
      failures.push(
        `The summary fact "${item.id}" reports ${item[delta]} ${delta} of a count of ${item.count}; what was ${delta} is part of the count.`,
      )
  return failures
}

/** A count figure's count, and in a comparison its added, removed and modified counts, are the documents' own for its kind. */
export function countFailures(item: SummaryCountItem, subject: StageSubject, counts: readonly SummaryCount[]): string[] {
  const matched = counts.filter(count => count.kind === item.kind && (!item.collection || count.collection === item.collection))
  const name = `"${item.noun.plural}" (${item.collection ? `${item.collection} of kind` : 'kind'} ${item.kind})`
  if (!matched.length) return [`The summary counts ${name}, which neither document has.`]
  const expected = {
    count: matched.reduce((sum, count) => sum + count.count, 0),
    ...Object.fromEntries(summaryDeltas.map(delta => [delta, matched.reduce((sum, count) => sum + (count[delta] ?? 0), 0)])),
  } as Record<'count' | (typeof summaryDeltas)[number], number>
  const failures: string[] = []
  for (const field of ['count', ...summaryDeltas] as const) {
    const reported = item[field] ?? 0
    if (subject.mode === 'extraction' && field !== 'count') {
      if (reported) failures.push(`The summary reports ${reported} ${field} ${name} for one extraction, which has no changes.`)
      continue
    }
    if (reported !== expected[field])
      failures.push(
        `The summary reports ${field === 'count' ? 'a total of ' : ''}${reported}${field === 'count' ? '' : ` ${field}`} for ${name}; the documents have ${expected[field]}.`,
      )
  }
  return failures
}
