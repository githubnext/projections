import type {Diagnostic, ExtractionDocument} from '@githubnext/projections-schemas'
import {formatRevisionLabel, revisionAge, type ExtractionChoice} from '@githubnext/projections-host'
import type {InspectorResultIdentity} from '../control.js'
import type {InspectorRevision} from '../types.js'

export const workingTree = 'working-tree'

/** The pair-picker key of an extraction: its commit, or `working-tree`. */
export function revisionKey(document: ExtractionDocument): string {
  const revision = document.provenance.revision
  return revision.kind === 'working-tree' ? workingTree : revision.commit
}
const shaPattern = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i
/**
 * Whether `ref` names `commit` by its hash: in full, or abbreviated as `git rev-parse --short` gives it (7 to 39 hex
 * digits, `5c95b54e0d1b`). Shorter hex names are left as refs: a branch may well be called `cafe`.
 */
const namesCommit = (ref: string, commit: string) =>
  shaPattern.test(ref) || ref === commit || (/^[0-9a-f]{7,39}$/i.test(ref) && commit.toLowerCase().startsWith(ref.toLowerCase()))
/** How long ago an ISO date was (`revisionAge`): `just now`, `5 minutes ago`, `2 days ago`. */
export const age = revisionAge
/**
 * A revision named for people, never a bare commit: its ref (or `Working tree`, or the short commit when the ref is
 * one), the commit's subject and its age when the runner listed it, for example `main · "Add auth" · 2 days ago`.
 */
export function choiceLabel(
  ref: string,
  document: ExtractionDocument,
  revisions: readonly (Pick<InspectorRevision, 'commit' | 'title' | 'date'> & Partial<Pick<InspectorRevision, 'ref' | 'kind'>>)[] = [],
  now?: number,
): string {
  const revision = document.provenance.revision
  if (ref === workingTree || revision.kind === 'working-tree') return `Working tree${revision.dirty ? ' · uncommitted changes' : ''}`
  // The working tree's entry carries HEAD's commit too, but not its subject.
  const known = revisions.find(item => item.commit === revision.commit && item.ref !== workingTree && item.kind !== 'working-tree')
  const commit = revision.commit.slice(0, 8)
  const name = namesCommit(ref, revision.commit) ? commit : ref
  const when = age(known?.date, now)
  // Without the commit's subject, a named ref keeps its commit beside it.
  const detail = known?.title ? `"${known.title}"` : name === commit ? undefined : commit
  return formatRevisionLabel({name, detail, when})
}
const suppliedPrefix = 'Supplied as extractor output in '
/**
 * The file a supplied extraction came from (`show --from FILE -p ID`, `compare --before-extraction FILE -p ID`): no
 * extractor ran, so its revision names only the definition's.
 */
function suppliedFile(document: ExtractionDocument): string | undefined {
  if (document.provenance.execution || document.provenance.reproducibility !== 'unknown') return undefined
  const limitation = document.provenance.limitations.find(text => text.startsWith(suppliedPrefix))
  if (!limitation) return 'Supplied extraction'
  const path = limitation.slice(suppliedPrefix.length).split('; ')[0] ?? ''
  return path.split(/[\\/]/).pop() || 'Supplied extraction'
}

/** The label of an extraction, for example `HEAD~1 · 1a2b3c4d`, `Working tree` or the file it was supplied in. */
export function revisionLabel(document: ExtractionDocument): string {
  const revision = document.provenance.revision
  const supplied = suppliedFile(document)
  if (supplied) return supplied
  if (revision.kind === 'working-tree') return 'Working tree'
  const commit = revision.commit.slice(0, 8)
  return namesCommit(revision.ref, revision.commit) ? commit : `${revision.ref} · ${commit}`
}
export function limitations(choices: readonly ExtractionChoice[]): Diagnostic[] {
  return choices.flatMap(choice =>
    choice.document.provenance.limitations.map(message => ({
      severity: 'warning' as const,
      code: 'EXTRACTION_LIMITATION',
      path: `/provenance/limitations (${choice.label})`,
      message,
    })),
  )
}
export function revisionOption(revision: InspectorRevision): string {
  if (revision.ref === workingTree) return `Working tree${revision.dirty ? ' (uncommitted changes)' : ''}`
  return `${revision.title} · ${revision.commit.slice(0, 8)}`
}

/** A revision in the sidebar: the working tree, HEAD, a recent commit, or a ref someone added. */
export interface RevisionRow {
  /** The ref extracted, as requested. */
  ref: string
  label: string
  detail?: string
}
/** An extraction's state, per projection and revision. */
export interface RowState {
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  jobId?: string
  started?: number
  ms?: number
  error?: string
  document?: ExtractionDocument
  /** The definition revision it applied. */
  definition?: string
}

/** How a ref reads in the Explorer and status line. */
export const refName = (ref: string) => (ref === workingTree ? 'Working tree' : /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 8) : ref)
export const symbolic = (ref: string) => ref !== workingTree && !/^[0-9a-f]{40}$/i.test(ref)

/** The shown pair's extractions as a host reads them: each side's job and the result's identity. */
export function resultsOf(
  rows: Record<string, RowState> | undefined,
  marked: {a?: string | undefined; b?: string | undefined},
): Record<string, InspectorResultIdentity> {
  const results: Record<string, InspectorResultIdentity> = {}
  for (const ref of [marked.a, marked.b]) {
    const row = ref ? rows?.[ref] : undefined
    if (!ref || !row || row.status !== 'done') continue
    const provenance = (row.document as {provenance?: {definitionDigest?: unknown; execution?: unknown}} | undefined)?.provenance
    const execution = provenance?.execution as InspectorResultIdentity['execution'] | undefined
    results[ref] = {
      ...(row.jobId ? {job: row.jobId} : {}),
      ...(typeof provenance?.definitionDigest === 'string' ? {definitionDigest: provenance.definitionDigest} : {}),
      ...(execution && typeof execution === 'object' ? {execution} : {}),
    }
  }
  return results
}
