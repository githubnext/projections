import type {ExtractionDocument} from '@githubnext/projections-schemas'
import type {InspectorDefinitionList, InspectorJob} from '../types.js'
import type {InspectorAppProps, InspectorOpenedOn} from './props.js'
import {workingTree, type RowState} from './revisions.js'

/** How many extractions are kept to present again (`extracted`), across projections, revisions and definitions. */
const maxExtracted = 24
export const extractedKey = (id: string, definition: string, ref: string) => JSON.stringify([id, definition, ref])

/** The rows a host restored (`initialResults`) for the projection it opened on. */
export function restoredRows(
  openedInitially: InspectorOpenedOn | undefined,
  initialResults: InspectorAppProps['initialResults'],
): Record<string, Record<string, RowState>> {
  const kept = openedInitially?.projection && initialResults ? Object.entries(initialResults) : []
  if (!kept.length) return {}
  const restored = kept.map(([ref, result]): [string, RowState] => [
    ref,
    {
      status: 'done',
      document: result.document as ExtractionDocument,
      definition: result.definition ?? workingTree,
      ...(result.job ? {jobId: result.job} : {}),
    },
  ])
  return {[openedInitially!.projection!]: Object.fromEntries(restored)}
}

/** Keeps each done extraction in `cache` (most recent last), at most `maxExtracted` of them. */
export function rememberExtracted(cache: Map<string, RowState>, rows: Record<string, Record<string, RowState>>) {
  for (const [id, refs] of Object.entries(rows)) {
    for (const [ref, row] of Object.entries(refs)) {
      if (row.status !== 'done' || !row.document || !row.definition) continue
      const key = extractedKey(id, row.definition, ref)
      if (cache.get(key) === row) continue
      cache.delete(key)
      cache.set(key, row)
    }
  }
  for (const key of [...cache.keys()].slice(0, Math.max(0, cache.size - maxExtracted))) cache.delete(key)
}

type Definition = InspectorDefinitionList['definitions'][number]

/**
 * A finished job's row state: done with its extraction, cancelled, or failed with why. Another projection's extractor
 * ran (an override, `runAs`): its extraction is this projection's (`own`).
 */
export function jobOutcome(
  update: InspectorJob,
  target: {projection: string; runAs?: string | undefined},
  own: Definition | undefined,
): Partial<RowState> {
  if (update.status === 'completed' && update.extraction) {
    const document =
      target.runAs && target.runAs !== target.projection && own
        ? {
            ...update.extraction,
            projection: {
              ...update.extraction.projection,
              id: own.id,
              title: own.title ?? own.id,
              renderer: own.renderer,
            },
          }
        : update.extraction
    return {status: 'done', document}
  }
  if (update.status === 'cancelled') return {status: 'cancelled'}
  const message =
    update.status === 'completed'
      ? 'The extractor completed without an extraction.'
      : (update.diagnostics[0]?.message ?? 'Extraction failed.')
  return {status: 'failed', error: message}
}
