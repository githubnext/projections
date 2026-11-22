import {useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction} from 'react'
import type {InspectorApi} from '../client/api.js'
import type {InspectorDefinitionList} from '../types.js'
import {ExtractionCoordinator} from './extraction-coordinator.js'
import {restoredRows} from './extraction-state.js'
import type {Marks} from './pairs.js'
import type {InspectorAppProps, InspectorOpenedOn} from './props.js'

export type {QueuedExtraction, Rows} from './extraction-coordinator.js'

/**
 * Extractions per projection and revision (`ExtractionCoordinator`), for as long as the Inspector is mounted: each
 * `api` is a client generation, ended when it is replaced or the Inspector unmounts.
 */
export function useExtractions({
  api,
  projection,
  definitionRevision,
  extractorFrom,
  runnable,
  definitions,
  marks,
  setError,
  setPanelRequest,
  openedInitially,
  initialResults,
}: {
  api: InspectorApi | undefined
  projection: string
  definitionRevision: string
  extractorFrom: string
  runnable: boolean
  definitions: InspectorDefinitionList | null
  marks: Record<string, Marks>
  setError: Dispatch<SetStateAction<string | null>>
  setPanelRequest: Dispatch<SetStateAction<{tab: string; at: number} | undefined>>
  openedInitially: InspectorOpenedOn | undefined
  initialResults: InspectorAppProps['initialResults']
}) {
  const latest = useRef({definitions, marks, setError, setPanelRequest})
  latest.current = {definitions, marks, setError, setPanelRequest}
  const [coordinator] = useState(
    () =>
      new ExtractionCoordinator(
        {
          definition: id => latest.current.definitions?.definitions.find(item => item.id === id),
          shown(id, ref) {
            const shown = latest.current.marks[id]
            return ref === shown?.a || ref === shown?.b
          },
          report(message, diagnostics) {
            latest.current.setError(message)
            if (diagnostics) latest.current.setPanelRequest({tab: 'diagnostics', at: Date.now()})
          },
        },
        restoredRows(openedInitially, initialResults),
      ),
  )
  useEffect(() => {
    coordinator.connect(api)
    return () => coordinator.disconnect()
  }, [coordinator, api])
  const {jobs, rows, queue, active} = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot)

  const extract = useCallback(
    // `keep`: the extractions already made under other definitions stay (extracting under this one, not again).
    (refs: readonly string[], keep = false) => {
      if (!runnable) return
      setError(null)
      coordinator.extract(projection, refs, {definition: definitionRevision, runAs: extractorFrom, keep})
    },
    [coordinator, runnable, projection, definitionRevision, extractorFrom, setError],
  )
  const busy = Boolean(active) || queue.length > 0
  const {setRows, dropQueued, extracted, forget, cancel} = coordinator
  return {jobs, rows, setRows, dropQueued, active, extracted, forgetExtracted: forget, extract, cancel, busy}
}
