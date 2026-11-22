import type {ChangeRecord, ResultStamp, Staleness, StalenessInput} from '../staleness.ts'
import {readsEdits, symbolic, workingTree} from './edits.ts'

/** The change kinds after `since`, and whether they are complete (a gap in the generations, or `complete: false`, isn't). */
export function changesSince(records: readonly ChangeRecord[], since: number): {kinds: Set<string>; complete: boolean} {
  const after = records.filter(record => record.generation > since).toSorted((a, b) => a.generation - b.generation)
  const kinds = new Set(after.flatMap(record => record.changes))
  let complete = after.every(record => record.complete)
  // Each record covers the changes since the generation before it: a missing one is unknown.
  let expected = since + 1
  for (const record of after) {
    if (record.generation !== expected) complete = false
    expected = record.generation + 1
  }
  return {kinds, complete}
}

/** The changes rule: what touched the projection after the result's generation. */
export function staleByChanges(stamp: ResultStamp, input: StalenessInput): Staleness | undefined {
  const {kinds, complete} = changesSince(input.records, stamp.generation)
  if (complete && kinds.size === 0) return undefined
  // Unknown changes (a gap, or the backend couldn't say what changed): anything may have.
  if (!complete) return {tier: 'extraction', why: 'working tree'}
  const changed = (kind: string) => !complete || kinds.has(kind)
  const id = stamp.projection
  if (readsEdits(stamp, input.definition) && changed('definitions')) return {tier: 'extraction', why: 'definition'}
  // An extractor script runs from the working tree whichever definition names it.
  if (changed(`extractor:${id}`)) return {tier: 'extraction', why: 'extractor'}
  const refs = stamp.sides.map(side => side.ref)
  if (changed(workingTree)) {
    if (refs.includes(workingTree)) return {tier: 'extraction', why: 'working tree'}
    // The working tree's kind covers HEAD too: a commit or checkout moves symbolic refs, and a committed definition.
    const moving = refs.some(symbolic) || (stamp.definition !== undefined && symbolic(stamp.definition))
    if (moving && stamp.head && input.head && stamp.head !== input.head) return {tier: 'extraction', why: 'refs moved'}
  }
  if (stamp.pair.before && changed(`comparator:${id}`) && !input.recompares) return {tier: 'comparison', why: 'comparator'}
  return undefined
}
