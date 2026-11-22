import {useEffect, useRef, useState, type Dispatch, type SetStateAction} from 'react'
import type {InspectorApi} from '../client/api.js'
import type {InspectorRevision} from '../types.js'
import type {Marks} from './pairs.js'
import type {InspectorAppProps} from './props.js'
import {symbolic, workingTree} from './revisions.js'
import type {Rows} from './use-extractions.js'
import {bumpedRenderers, bumpedScenarios, changeSet, withoutStale, type ChangeSet} from './change-set.js'

type Versions = Record<string, number>

/**
 * The shown pair's sides to extract again: those whose code or working tree changed, and, when HEAD moved (a commit or
 * checkout), its symbolic refs (HEAD, HEAD~1, a branch) too.
 */
async function staleRefs(
  api: InspectorApi,
  current: {projection: string; rows: Rows; revisions: readonly InspectorRevision[]},
  set: ChangeSet,
  pairRefs: readonly string[],
  signal: AbortSignal,
  setRevisions: Dispatch<SetStateAction<InspectorRevision[]>>,
): Promise<string[]> {
  const present = pairRefs.filter(ref => current.rows[current.projection]?.[ref])
  const refs = present.filter(ref => set.code(current.projection) || (ref === workingTree && set.changed('working-tree')))
  if (!set.changed('working-tree') || !present.some(symbolic)) return refs
  const before = current.revisions.find(item => item.ref !== workingTree)?.commit
  const list = await api.revisions(signal, 30).catch(() => undefined)
  if (!list) return refs
  setRevisions(list.revisions)
  if (list.revisions.find(item => item.ref !== workingTree)?.commit !== before) {
    for (const ref of present) if (symbolic(ref) && !refs.includes(ref)) refs.push(ref)
  }
  return refs
}

/**
 * The live preview: follows the runner's changes (`GET /api/changes`) and, per `refresh`, extracts the shown pair
 * again, compares it again, reloads renderer bundles and scenarios, and says why (`replay`).
 */
export function useLiveChanges({
  api,
  refresh,
  forgetExtracted,
  setRows,
  setRevisions,
  setRendererVersions,
  setScenarioVersions,
  live,
  runnable,
  projection,
  rows,
  revisions,
  marked,
  extract,
  refreshDefinitions,
  retry,
  definitionRevision,
}: {
  api: InspectorApi | undefined
  refresh: NonNullable<InspectorAppProps['refresh']>
  forgetExtracted: (drop: (id: string, ref: string, definition: string) => boolean) => void
  setRows: Dispatch<SetStateAction<Rows>>
  setRevisions: Dispatch<SetStateAction<InspectorRevision[]>>
  setRendererVersions: Dispatch<SetStateAction<Versions>>
  setScenarioVersions: Dispatch<SetStateAction<Versions>>
  live: boolean
  runnable: boolean
  projection: string
  rows: Rows
  revisions: readonly InspectorRevision[]
  marked: Marks
  extract: (refs: readonly string[], keep?: boolean) => void
  refreshDefinitions: (ref: string, quiet?: boolean) => Promise<void>
  retry: () => void
  definitionRevision: string
}) {
  // Whether the runner reports working-tree changes.
  const [watching, setWatching] = useState(false)
  // The last change that made the live preview run again: its kinds (`GET /api/changes`) and when.
  const [replay, setReplay] = useState<{kinds: string[]; complete: boolean; at: number} | undefined>()
  // `compare`: results stay as they are, except that a comparator change compares them again (nothing extracts).
  const manual = refresh === 'manual' || refresh === 'compare'
  const recompare = refresh !== 'manual'
  const latest = useRef({
    live,
    runnable,
    projection,
    rows,
    revisions,
    marked,
    extract,
    refreshDefinitions,
    retry,
    manual,
    recompare,
    definitionRevision,
  })
  latest.current = {
    live,
    runnable,
    projection,
    rows,
    revisions,
    marked,
    extract,
    refreshDefinitions,
    retry,
    manual,
    recompare,
    definitionRevision,
  }
  useEffect(() => {
    if (!api) return
    const abort = new AbortController()
    /** Responds to one change: reloads what it touched, drops stale extractions and runs the preview again. */
    async function respond(set: ChangeSet) {
      const {changes, complete, changed, changedPart} = set
      const current = latest.current
      // A host that refreshes by hand keeps the definitions it applies (the committed ones stay as they are).
      if (changed('definitions') || changedPart('renderer')) {
        void current.refreshDefinitions(current.manual ? current.definitionRevision : workingTree, true)
      }
      if (changedPart('renderer')) setRendererVersions(versions => bumpedRenderers(versions, set, current.rows))
      // The shown pair is extracted again, both sides when the code changed, keeping what is shown until the new
      // extractions arrive; others are dropped and extracted when they are next shown. A host that refreshes by hand
      // keeps what is shown, whichever definition it applied.
      const pairRefs =
        current.live || current.manual ? [current.marked.a, current.marked.b].filter((ref): ref is string => Boolean(ref)) : []
      forgetExtracted(set.stale)
      setRows(rows => withoutStale(rows, set, current.projection, pairRefs))
      if (current.live && current.runnable && current.projection && !current.manual) {
        const refs = await staleRefs(api!, current, set, pairRefs, abort.signal, setRevisions)
        if (refs.length) {
          setReplay({kinds: changes, complete, at: Date.now()})
          current.extract(refs)
        }
      }
      if (current.projection && changed(`comparator:${current.projection}`) && current.recompare) {
        setReplay({kinds: changes, complete, at: Date.now()})
        current.retry()
      }
      if (current.projection && complete && changes.includes(`renderer:${current.projection}`) && current.rows[current.projection]) {
        setReplay(previous => (previous && Date.now() - previous.at < 1000 ? previous : {kinds: changes, complete, at: Date.now()}))
      }
      // Scenarios are made with the working tree's definition, so a new definition remakes them too.
      if (changed('definitions') || changedPart('scenarios') || changedPart('extractor')) {
        setScenarioVersions(versions => bumpedScenarios(versions, set, current.projection))
      }
    }
    void (async () => {
      let since: number | undefined
      while (!abort.signal.aborted) {
        let result
        try {
          result = await api.changes(since ?? 0, abort.signal)
        } catch {
          if (abort.signal.aborted) return
          setWatching(false)
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        }
        if (!result) return
        setWatching(true)
        if (since !== undefined && result.generation !== since) await respond(changeSet(result))
        since = result.generation
      }
    })()
    return () => abort.abort()
  }, [api, forgetExtracted, setRows, setRevisions, setRendererVersions, setScenarioVersions])
  return {watching, replay}
}
