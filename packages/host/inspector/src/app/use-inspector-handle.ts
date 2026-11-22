import {useEffect, useRef} from 'react'
import type {Dispatch, SetStateAction} from 'react'
import type {ControllerStore} from '../details.js'
import type {InspectorHandle} from '../control.js'
import type {ProjectionStatus} from '../shell/switcher.js'
import type {Marks} from './pairs.js'
import type {ScenarioRequest} from './use-scenarios.js'
import {inspectorSummary, keptResults, withoutQueued} from './handle-summary.js'
import type {HandleState} from './handle-summary.js'
import type {QueuedExtraction, Rows} from './use-extractions.js'

/** What the handle does, with the latest render's callbacks. */
export interface HandleActions {
  switchProjection: (id: string) => void
  switcherStatus: (id: string) => ProjectionStatus | undefined
  extract: (refs: readonly string[], keep?: boolean) => void
  retry: () => void
  chooseDefinition: (ref: string) => void
  cancel: () => Promise<void>
  requestScenario: (request: ScenarioRequest) => void
}

/** Gives `handleRef` the handle a host drives this Inspector with; it reads the latest state when called. */
export function useInspectorHandle({
  handleRef,
  controllers,
  state,
  actions,
  setSource,
  setMarks,
  dropQueued,
  setRows,
}: {
  handleRef: ((handle: InspectorHandle | null) => void) | undefined
  controllers: ControllerStore
  state: HandleState
  actions: HandleActions
  setSource: Dispatch<SetStateAction<'live' | 'artifact'>>
  setMarks: Dispatch<SetStateAction<Record<string, Marks>>>
  dropQueued: (drop: (item: QueuedExtraction) => boolean) => void
  setRows: Dispatch<SetStateAction<Rows>>
}) {
  const handleState = useRef(state)
  handleState.current = state
  const handleActions = useRef(actions)
  handleActions.current = actions
  // The projection the host last selected, until the Inspector shows it: a scenario asked for next is that one's.
  const selected = useRef<string>(undefined)
  if (selected.current === state.projection) selected.current = undefined
  useEffect(() => {
    if (!handleRef) return
    const handle: InspectorHandle = {
      selectProjection(id) {
        const known = handleState.current.definitions?.definitions.some(item => item.id === id)
        if (!known) throw new Error(`The runner defines no projection ${id}`)
        selected.current = id === handleState.current.projection ? undefined : id
        handleActions.current.switchProjection(id)
      },
      setPair({before: a, after: b, projection: id, definitionRevision: revision}) {
        const target = id ?? handleState.current.projection
        if (!target) throw new Error('No projection is selected')
        if (id && id !== handleState.current.projection) handle.selectProjection(id)
        if (revision && revision !== handleState.current.definitionRevision) handleActions.current.chooseDefinition(revision)
        setSource('live')
        setMarks(current => ({...current, [target]: a ? {a, b} : {b}}))
        // A pair switched away from before it was extracted isn't extracted (its running job finishes).
        const wanted = new Set([a, b])
        dropQueued(item => item.projection === target && !wanted.has(item.ref))
        setRows(current => withoutQueued(current, target, wanted))
      },
      view: () => controllers.get() ?? null,
      results: () => keptResults(handleState.current),
      setDefinitionRevision(ref) {
        handleActions.current.chooseDefinition(ref)
      },
      showScenario(id) {
        const from = handleState.current.projection
        handleActions.current.requestScenario({projection: selected.current ?? from, id, from})
      },
      cancel() {
        void handleActions.current.cancel()
      },
      refresh() {
        const {marked: shown} = handleState.current
        handleActions.current.extract([shown.a, shown.b].filter((ref): ref is string => Boolean(ref)))
        handleActions.current.retry()
      },
      selectEntity(id) {
        const controller = controllers.get()
        if (!controller) return false
        if (id !== null && !controller.rows.some(row => row.id === id)) return false
        controller.select(id)
        return true
      },
      summary() {
        const state = handleState.current
        return inspectorSummary(
          state,
          controllers.get(),
          state.projection ? handleActions.current.switcherStatus(state.projection) : undefined,
        )
      },
    }
    handleRef(handle)
    return () => handleRef(null)
  }, [handleRef, controllers, setSource, setMarks, dropQueued, setRows])
}
