import {useEffect} from 'react'
import type {Dispatch, RefObject, SetStateAction} from 'react'
import {extractedKey} from './extraction-state.js'
import type {Marks} from './pairs.js'
import type {RowState} from './revisions.js'
import type {Rows} from './use-extractions.js'

/**
 * Extracts both sides of the shown pair as soon as the projection can run, and again under a new definition
 * revision; extractions made before under that definition (`extracted`) are presented again instead.
 */
export function useExtractedPair({
  runnable,
  projection,
  paired,
  marked,
  rows,
  setRows,
  definitionRevision,
  extract,
  extracted,
}: {
  runnable: boolean
  projection: string
  paired: boolean
  marked: Marks
  rows: Rows
  setRows: Dispatch<SetStateAction<Rows>>
  definitionRevision: string
  extract: (refs: readonly string[], keep?: boolean) => void
  extracted: RefObject<Map<string, RowState>>
}) {
  useEffect(() => {
    if (!runnable || !projection || !paired) return
    const stale = [marked.a, marked.b].filter((ref): ref is string => {
      if (!ref) return false
      const row = rows[projection]?.[ref]
      if (!row) return true
      return row.definition !== undefined && row.definition !== definitionRevision && row.status !== 'running' && row.status !== 'queued'
    })
    if (!stale.length) return
    // Extracted before under this definition: presented again.
    const reused = new Map(
      stale.flatMap(ref => {
        const row = extracted.current.get(extractedKey(projection, definitionRevision, ref))
        return row ? [[ref, row] as const] : []
      }),
    )
    if (reused.size) setRows(current => ({...current, [projection]: {...current[projection], ...Object.fromEntries(reused)}}))
    const rest = stale.filter(ref => !reused.has(ref))
    if (rest.length) extract(rest, true)
  }, [runnable, projection, paired, marked, rows, setRows, definitionRevision, extract, extracted])
}
