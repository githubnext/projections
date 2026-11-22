import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {Dispatch, SetStateAction} from 'react'
import type {InspectorApi} from '../client/api.js'
import type {InspectorDefinitionList, InspectorRevision} from '../types.js'
import {repositoryKey} from './definitions.js'
import {errorText} from './errors.js'
import {currentKey, openedOn, readJson} from './persistence.js'
import type {InspectorOpenedOn} from './props.js'
import {workingTree} from './revisions.js'

/**
 * What the runner says of the repository: the projections it defines (at the revision whose definitions apply), the
 * one selected, and recent revisions. It reads them at startup, opening on the projection last chosen here.
 */
export function useRepository({
  api,
  openedInitially,
  openedDefinitionRevision,
  setError,
}: {
  api: InspectorApi | undefined
  openedInitially: InspectorOpenedOn | undefined
  openedDefinitionRevision: string | undefined
  setError: Dispatch<SetStateAction<string | null>>
}) {
  const [definitions, setDefinitions] = useState<InspectorDefinitionList | null>(null)
  const [revisions, setRevisions] = useState<InspectorRevision[]>([])
  const [projection, setProjection] = useState('')
  const [definitionRevision, setDefinitionRevision] = useState(openedDefinitionRevision ?? workingTree)
  const [lists, setLists] = useState<Record<string, InspectorDefinitionList>>({})
  const [loading, setLoading] = useState(Boolean(api))
  const [connected, setConnected] = useState<boolean | undefined>(undefined)
  // This repository's identity in this browser (`repositoryKey`), for remembering its pairs and tip.
  const [repoKey, setRepoKey] = useState('')

  // Startup: definitions at the working tree, and recent revisions.
  useEffect(() => {
    if (!api) return
    const abort = new AbortController()
    setLoading(true)
    Promise.all([api.definitions(openedDefinitionRevision ?? workingTree, abort.signal), api.revisions(abort.signal, 30)])
      .then(([list, revisionList]) => {
        setDefinitions(list)
        setLists(current => ({...current, [list.ref]: list}))
        setRepoKey(repositoryKey(list))
        setRevisions(revisionList.revisions)
        // The projection last chosen in this repository, else the first.
        const last = openedOn(openedInitially).projection ?? readJson<string>(currentKey(repositoryKey(list)))
        setProjection(list.definitions.some(item => item.id === last) ? last! : (list.definitions[0]?.id ?? ''))
        setConnected(true)
        setLoading(false)
      })
      .catch((failure: unknown) => {
        if (abort.signal.aborted) return
        setConnected(false)
        setError(errorText(failure))
        setLoading(false)
      })
    return () => abort.abort()
  }, [api, openedInitially, openedDefinitionRevision, setError])
  const refreshDefinitions = useCallback(
    async (ref: string, quiet = false) => {
      if (!api) return
      if (!quiet) {
        setLoading(true)
        setError(null)
      }
      try {
        const list = await api.definitions(ref)
        setDefinitions(list)
        setLists(current => ({...current, [list.ref]: list}))
        setProjection(current =>
          list.definitions.some(definition => definition.id === current) ? current : (list.definitions[0]?.id ?? ''),
        )
        setConnected(true)
      } catch (failure) {
        setError(errorText(failure))
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [api, setError],
  )
  const chooseDefinition = useCallback(
    (ref: string) => {
      setDefinitionRevision(ref)
      void refreshDefinitions(ref)
    },
    [refreshDefinitions],
  )
  const definitionOptions = useMemo<InspectorRevision[]>(
    () =>
      revisions.some(item => item.ref === workingTree) ? revisions : [{ref: workingTree, commit: '', title: 'Working tree'}, ...revisions],
    [revisions],
  )
  return {
    definitions,
    revisions,
    setRevisions,
    projection,
    setProjection,
    definitionRevision,
    lists,
    loading,
    connected,
    repoKey,
    refreshDefinitions,
    chooseDefinition,
    definitionOptions,
  }
}

/** The first projection a repository defines replaces the built-in defaults in the preview. */
export function useFirstDefinition({
  definitions,
  setProjection,
  setSource,
}: {
  definitions: InspectorDefinitionList | null
  setProjection: (projection: string) => void
  setSource: (source: 'live' | 'artifact') => void
}) {
  const hadSetup = useRef(false)
  useEffect(() => {
    if (definitions?.ref !== workingTree) return
    if (hadSetup.current && !definitions.setup && definitions.definitions[0]) {
      setProjection(definitions.definitions[0].id)
      setSource('live')
    }
    hadSetup.current = Boolean(definitions.setup)
  }, [definitions, setProjection, setSource])
}
