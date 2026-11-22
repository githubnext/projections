import {useCallback, useMemo, useState} from 'react'
import type {ExtractionDocument} from '@githubnext/projections-schemas'
import type {ExtractionChoice} from '@githubnext/projections-host'
import type {InspectorApi} from '../client/api.js'
import {useHostRevisionLabels} from '../host.js'
import type {PartOverrides} from '../parts/model.js'
import type {InspectorDefinitionList, InspectorRevision} from '../types.js'
import type {Artifact} from './artifacts.js'
import type {Marks} from './pairs.js'
import {historyRows, overriddenDocument, presentedSides} from './presented-pair.js'
import type {HeldPair} from './presented-pair.js'
import {choiceLabel} from './revisions.js'
import type {RevisionRow} from './revisions.js'
import type {Rows} from './use-extractions.js'

/**
 * The pair the main view presents: the live extractions of the selected projection (with the session's part
 * overrides applied) or the saved artifact, and its Before and After keys. While a newly chosen pair is extracting,
 * the pair shown before stays, and before any pair has been shown, none is (no After).
 */
export function usePresentedPair({
  api,
  revisions,
  added,
  marked,
  projection,
  rows,
  overrides,
  definitions,
  source,
  artifact,
  artifactMarks,
  runnable,
  definitionRevision,
}: {
  api: InspectorApi | undefined
  revisions: readonly InspectorRevision[]
  added: readonly string[]
  marked: Marks
  projection: string
  rows: Rows
  overrides: Record<string, PartOverrides>
  definitions: InspectorDefinitionList | null
  source: 'live' | 'artifact'
  artifact: Artifact | null
  artifactMarks: Marks
  runnable: boolean
  definitionRevision: string
}) {
  // The pair last presented whole. While a newly chosen pair is still extracting, it stays presented (rather than one
  // side alone, or nothing), so a host switching pairs shows one change once the new pair is ready.
  const [held, setHeld] = useState<HeldPair>()
  // The revisions in the Explorer's History.
  const revisionRows = useMemo<RevisionRow[]>(
    () => (api ? historyRows({revisions, added, marked, held, projection}) : []),
    [api, revisions, added, marked, held, projection],
  )
  const projectionRows = useMemo(() => rows[projection] ?? {}, [rows, projection])

  const overridden = useCallback(
    (document: ExtractionDocument) => overriddenDocument(document, overrides, definitions),
    [overrides, definitions],
  )
  // One derived document per extraction while the overrides stay, so relabelling the choices never recomputes the pair.
  const effectiveDocument = useMemo(() => kept(overridden), [overridden])
  // What the main view presents: the live extractions of this projection, or a saved artifact.
  // The host's names for the pair's revisions (an editor names them as its own pickers do).
  const hostLabels = useHostRevisionLabels()
  const liveChoices = useMemo<ExtractionChoice[]>(
    () =>
      revisionRows.flatMap(row => {
        const extracted = projectionRows[row.ref]?.document
        if (!extracted) return []
        const document = effectiveDocument(extracted)
        return [{key: row.ref, label: hostLabels?.[row.ref] ?? choiceLabel(row.ref, document, revisions), document}]
      }),
    [revisionRows, projectionRows, effectiveDocument, hostLabels, revisions],
  )
  const showing: 'live' | 'artifact' = source === 'artifact' && artifact ? 'artifact' : 'live'
  const choices = showing === 'artifact' ? artifact!.choices : liveChoices
  const pairMarks = showing === 'artifact' ? artifactMarks : marked
  const has = (key: string | undefined) => Boolean(key && choices.some(choice => choice.key === key))
  // A side of the chosen pair still to extract (or extracting again), as opposed to extracted, failed or cancelled.
  const pending = (ref: string | undefined) => {
    // Nothing extracts while the projection can't run (it needs trust): the chosen pair shows what it has.
    if (!ref || !runnable) return false
    const row = projectionRows[ref]
    return !row || row.status === 'queued' || row.status === 'running' || (row.status === 'done' && row.definition !== definitionRevision)
  }
  const switching = showing === 'live' && (pending(marked.a) || pending(marked.b))
  const holding = switching && held?.projection === projection && has(held.after) && (!held.before || has(held.before)) ? held : undefined
  const {before, after} = presentedSides({
    live: showing === 'live',
    marked,
    pairMarks,
    holding,
    pending: switching,
    has,
    lastChoice: choices.at(-1)?.key,
  })
  // The chosen pair, once ready, is the pair held through the next switch.
  if (showing === 'live' && !switching && after && (held?.projection !== projection || held.before !== before || held.after !== after)) {
    setHeld({projection, before, after})
  }
  return {revisionRows, projectionRows, showing, choices, before, after, switching}
}

/** `derive`, each result kept for the document it was derived from. */
function kept(derive: (document: ExtractionDocument) => ExtractionDocument): (document: ExtractionDocument) => ExtractionDocument {
  const derived = new WeakMap<ExtractionDocument, ExtractionDocument>()
  return document => {
    const found = derived.get(document)
    if (found) return found
    const made = derive(document)
    derived.set(document, made)
    return made
  }
}
