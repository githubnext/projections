import type {Definition, ExtractionDocument} from '@githubnext/projections-schemas'
import {overriddenDefinition} from '../parts/model.js'
import type {PartOverrides} from '../parts/model.js'
import type {InspectorDefinitionList, InspectorRevision} from '../types.js'
import type {Marks} from './pairs.js'
import {workingTree} from './revisions.js'
import type {RevisionRow} from './revisions.js'

/** A pair presented whole, held while a newly chosen one extracts. */
export interface HeldPair {
  projection: string
  before: string
  after: string
}

/** The revisions in the Explorer's History: the working tree, HEAD, the pair's and added refs, recent commits. */
export function historyRows({
  revisions,
  added,
  marked,
  held,
  projection,
}: {
  revisions: readonly InspectorRevision[]
  added: readonly string[]
  marked: Marks
  held: HeldPair | undefined
  projection: string
}): RevisionRow[] {
  const working = revisions.find(item => item.ref === workingTree)
  const head = revisions.find(item => item.ref !== workingTree)
  const list: RevisionRow[] = [
    {ref: workingTree, label: 'Working tree', detail: working?.dirty ? 'Uncommitted changes' : 'No uncommitted changes'},
    {ref: 'HEAD', label: 'HEAD', ...(head ? {detail: `${head.title} · ${head.commit.slice(0, 8)}`} : {})},
  ]
  const listed = (ref: string) => list.some(row => row.ref === ref)
  for (const ref of [marked.a, marked.b]) if (ref && !listed(ref)) list.push({ref, label: ref, detail: 'Chosen ref'})
  for (const ref of held?.projection === projection ? [held.before, held.after] : []) {
    if (ref && !listed(ref)) list.push({ref, label: ref, detail: 'Shown ref'})
  }
  for (const ref of added) if (!listed(ref)) list.push({ref, label: ref, detail: 'Added ref'})
  for (const item of revisions) {
    if (item.ref === workingTree || listed(item.commit)) continue
    list.push({
      ref: item.commit,
      label: item.title || item.commit.slice(0, 8),
      detail: `${item.commit.slice(0, 8)}${item.date ? ` · ${item.date.slice(0, 10)}` : ''}`,
    })
  }
  return list
}

/** The renderer and comparator a document is presented and compared with: its definition's, or the session's overrides. */
export function overriddenDocument(
  document: ExtractionDocument,
  overrides: Record<string, PartOverrides>,
  definitions: InspectorDefinitionList | null,
): ExtractionDocument {
  const parts = overrides[document.projection.id]
  if (!parts?.renderer && !parts?.comparator) return document
  const all = definitions?.definitions ?? []
  const own = all.find(item => item.id === document.projection.id)
  if (!own) return document
  const next = overriddenDefinition(own, parts, all)
  const definition: Definition = {...document.provenance.definition, renderer: next.renderer}
  if (parts.comparator) {
    if (next.comparator !== undefined && next.comparator !== '') definition.comparator = next.comparator
    else delete definition.comparator
  }
  return {...document, projection: {...document.projection, renderer: next.renderer}, provenance: {...document.provenance, definition}}
}

/**
 * The shown pair's Before and After keys. Live, the pair is what is shown: a side that failed leaves the other shown
 * alone; while a side is still to extract (`pending`), another pair shown whole (`holding`) stays until this one is
 * ready, and without one nothing is shown yet (no After), so the view never presents one side as if it were the pair.
 * An artifact shows its marked pair, or its last choice.
 */
export function presentedSides({
  live,
  marked,
  pairMarks,
  holding,
  pending = false,
  has,
  lastChoice,
}: {
  live: boolean
  marked: Marks
  pairMarks: Marks
  holding: HeldPair | undefined
  /** Whether a side of the chosen pair is still to extract. */
  pending?: boolean
  has: (key: string | undefined) => boolean
  lastChoice: string | undefined
}): {before: string; after: string | undefined} {
  if (holding) return {before: holding.before, after: holding.after}
  if (live && pending) return {before: '', after: undefined}
  const liveAfter = has(marked.b) ? marked.b : has(marked.a) ? marked.a : undefined
  const after = live ? liveAfter : pairMarks.b && has(pairMarks.b) ? pairMarks.b : lastChoice
  const before = pairMarks.a && pairMarks.a !== after && has(pairMarks.a) && (!live || has(marked.b)) ? pairMarks.a : ''
  return {before, after}
}
