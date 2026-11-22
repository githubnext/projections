import {useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction} from 'react'
import type {InspectorApi} from '../client/api.js'
import type {InspectorPairs, InspectorRevision} from '../types.js'
import {defaultPair, isMarks, marking, suggestedMarks, type Marks} from './pairs.js'
import {currentKey, openedOn, pairKey, readJson, writeJson} from './persistence.js'
import {useRecentPairs} from './recent-pairs.js'
import type {InspectorOpenedOn} from './props.js'
import {workingTree} from './revisions.js'

/**
 * Choosing the Before → After pair: marking revisions, swapping, one revision or two, the runner's suggested pairs,
 * and switching projection with the pair kept. Each projection's pair and recent pairs are remembered per repository.
 */
export function usePairSelection({
  api,
  projection,
  setProjection,
  repoKey,
  revisions,
  marks,
  setMarks,
  marked,
  openedInitially,
  showing,
  before,
  after,
  setArtifactMarks,
  setSource,
}: {
  api: InspectorApi | undefined
  projection: string
  setProjection: Dispatch<SetStateAction<string>>
  repoKey: string
  revisions: readonly InspectorRevision[]
  marks: Record<string, Marks>
  setMarks: Dispatch<SetStateAction<Record<string, Marks>>>
  marked: Marks
  openedInitially: InspectorOpenedOn | undefined
  showing: 'live' | 'artifact'
  before: string
  after: string | undefined
  setArtifactMarks: Dispatch<SetStateAction<Marks>>
  setSource: Dispatch<SetStateAction<'live' | 'artifact'>>
}) {
  const recent = useRecentPairs(api, repoKey, projection, marks[projection])
  // The runner's suggested pairs per projection: undefined until asked, null when it suggests none.
  const [suggested, setSuggested] = useState<Record<string, InspectorPairs | null>>({})
  const setMark = useCallback(
    (letter: 'A' | 'B', key: string, artifactRow: boolean) => {
      if (artifactRow) {
        setArtifactMarks(current => marking(current, letter, key))
        setSource('artifact')
      } else {
        setMarks(current => ({...current, [projection]: marking(current[projection] ?? {}, letter, key)}))
        setSource('live')
      }
    },
    [projection, setArtifactMarks, setSource, setMarks],
  )
  const swap = useCallback(() => {
    if (showing === 'artifact') {
      if (before && after) setArtifactMarks({a: after, b: before})
    } else if (marked.a && marked.b) setMarks(current => ({...current, [projection]: {a: marked.b, b: marked.a}}))
  }, [before, after, showing, projection, marked, setArtifactMarks, setMarks])
  const canSwap = showing === 'artifact' ? Boolean(before && after) : Boolean(marked.a && marked.b)
  // The runner's pairs for this projection: bookmarks, branch and tags, and the default. Asked again when HEAD moves.
  const headCommit = revisions.find(item => item.ref !== workingTree)?.commit
  useEffect(() => {
    if (!api || !projection) return undefined
    const abort = new AbortController()
    api
      .pairs(projection, abort.signal)
      .then(list => setSuggested(current => ({...current, [projection]: list})))
      .catch(() => {
        if (!abort.signal.aborted) setSuggested(current => ({...current, [projection]: null}))
      })
    return () => abort.abort()
  }, [api, projection, headCommit])
  const pairsHere = suggested[projection]
  const projectionDefault = useMemo(() => (pairsHere ? suggestedMarks(pairsHere.default) : defaultPair(revisions)), [pairsHere, revisions])
  // Each projection opens on its remembered pair in this repository, or the default; the pair and recent pairs are remembered.
  useEffect(() => {
    if (!api || !projection || !repoKey || !revisions.length || marks[projection] || pairsHere === undefined) return
    const opened = openedOn(openedInitially)
    const saved = opened.projection === projection && opened.pair ? opened.pair : readJson(pairKey(repoKey, projection), isMarks)
    setMarks(current => ({...current, [projection]: saved?.b ? {a: saved.a, b: saved.b} : projectionDefault}))
  }, [api, projection, repoKey, revisions, marks, setMarks, pairsHere, projectionDefault, openedInitially])
  /** Shows a Before → After pair (or one revision, without `a`) of the selected projection. */
  const choosePair = useCallback(
    (pair: Marks) => {
      setSource('live')
      setMarks(current => ({...current, [projection]: {a: pair.a, b: pair.b}}))
    },
    [projection, setSource, setMarks],
  )
  /**
   * Switches the projection being developed and keeps the data axis: the next projection is shown with the pair this
   * one shows (the pair is then remembered for it too). The choice is remembered for this repository.
   */
  const switchProjection = useCallback(
    (id: string) => {
      if (!id) return
      setMarks(current => (current[projection] && id !== projection ? {...current, [id]: {...current[projection]}} : current))
      setProjection(id)
      setSource('live')
      if (repoKey) writeJson(currentKey(repoKey), id)
    },
    [projection, repoKey, setMarks, setProjection, setSource],
  )
  // The Before a pair had when one revision was chosen, restored when two are compared again.
  const lastBefore = useRef<Record<string, string | undefined>>({})
  const toggleOne = useCallback(
    (one: boolean) => {
      setSource('live')
      setMarks(current => {
        const pair = current[projection] ?? {}
        const shownAfter = pair.b ?? workingTree
        if (one) {
          lastBefore.current[projection] = pair.a
          return {...current, [projection]: {b: shownAfter}}
        }
        const restored = lastBefore.current[projection] ?? projectionDefault.a ?? 'HEAD'
        return {
          ...current,
          [projection]: {a: restored === shownAfter ? (shownAfter === 'HEAD' ? 'HEAD~1' : 'HEAD') : restored, b: shownAfter},
        }
      })
    },
    [projection, projectionDefault, setSource, setMarks],
  )
  return {setMark, swap, canSwap, pairsHere, projectionDefault, recent, choosePair, switchProjection, toggleOne}
}
