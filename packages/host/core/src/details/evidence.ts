import type {rowItems} from '../model.js'
import type {Side} from '../modes.js'

/** A source location an item's evidence names. */
export interface EvidenceLocation {
  path: string
  line?: number
}

/** Evidence for a detail card: a location and the side whose revision it is in. */
export interface DetailEvidence extends EvidenceLocation {
  side: Side
}

/**
 * Where a host can link an evidence location, for example a pull request's file diff or a file at a commit; `undefined`
 * leaves it to `onOpen` (or plain text).
 */
export type EvidenceLink = (location: EvidenceLocation, side: Side) => string | undefined

/** A row's evidence: the after side's, then before-side files the after side doesn't name, each location once. */
export function rowEvidence(items: ReturnType<typeof rowItems>): DetailEvidence[] {
  const evidence: DetailEvidence[] = []
  const seen = new Set<string>()
  const afterPaths = new Set(items.after.flatMap(item => (item.evidence ?? []).map(entry => entry.source)))
  for (const side of ['after', 'before'] as const)
    for (const item of items[side])
      for (const entry of item.evidence ?? []) {
        if (side === 'before' && afterPaths.has(entry.source)) continue
        const key = `${side}:${entry.source}:${entry.location?.line ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        evidence.push({side, path: entry.source, ...(entry.location ? {line: entry.location.line} : {})})
      }
  return evidence
}
