import {useCallback, useEffect, useRef, useState} from 'react'
import type {Dispatch, SetStateAction} from 'react'
import type {InspectorApi} from '../client/api.js'
import type {InspectorPolicy, InspectorScenario, InspectorScenarioList} from '../types.js'
import {scenarioArtifact} from './artifacts.js'
import type {Artifact} from './artifacts.js'
import {errorText} from './errors.js'
import type {Marks} from './pairs.js'

const noScenarios: InspectorScenario[] = []

/** A scenario a host asked for: shown once `projection` is the shown one and its scenarios have loaded. */
export interface ScenarioRequest {
  projection: string
  id: string
  /** The projection shown when it was asked for: one switched to from there is another person's doing, and drops it. */
  from: string
}

/**
 * A custom renderer package's scenarios, refetched when `scenarioVersions` says they changed, and showing one as a
 * saved artifact is shown.
 */
export function useScenarios({
  api,
  projection,
  known,
  live,
  policy,
  showing,
  artifact,
  setError,
  setPanelRequest,
  setArtifact,
  setArtifactMarks,
  setSource,
}: {
  api: InspectorApi | undefined
  projection: string
  /** Whether the runner's definitions have loaded, and with them the projection's renderer package. */
  known: boolean
  live: boolean
  policy: InspectorPolicy
  showing: 'live' | 'artifact'
  artifact: Artifact | null
  setError: Dispatch<SetStateAction<string | null>>
  setPanelRequest: Dispatch<SetStateAction<{tab: string; at: number} | undefined>>
  setArtifact: Dispatch<SetStateAction<Artifact | null>>
  setArtifactMarks: Dispatch<SetStateAction<Marks>>
  setSource: Dispatch<SetStateAction<'live' | 'artifact'>>
}) {
  // The renderer package scenarios of each projection, and a version that refetches them when they change.
  const [scenarioLists, setScenarioLists] = useState<Record<string, InspectorScenarioList>>({})
  const [scenarioVersions, setScenarioVersions] = useState<Record<string, number>>({})
  const [requested, setRequested] = useState<ScenarioRequest>()
  // A custom renderer package's scenarios, offered beside the live working tree.
  const scenarioFile = live ? policy.scenarios : undefined
  const scenarioVersion = scenarioVersions[projection] ?? 0
  useEffect(() => {
    if (!api || !projection || !scenarioFile) return
    const abort = new AbortController()
    api
      .scenarios(projection, abort.signal)
      .then(list => setScenarioLists(current => ({...current, [projection]: list})))
      .catch((failure: unknown) => {
        if (abort.signal.aborted) return
        setError(`Could not load ${scenarioFile}: ${errorText(failure)}`)
        setRequested(current => (current?.projection === projection ? undefined : current))
      })
    return () => abort.abort()
  }, [api, projection, scenarioFile, scenarioVersion, setError])
  const scenarios = (scenarioFile && scenarioLists[projection]?.scenarios) || noScenarios
  const shownScenario = showing === 'artifact' ? artifact?.scenario : undefined
  const showScenario = useCallback(
    (id: string) => {
      const scenario = scenarios.find(item => item.id === id)
      if (!scenario) {
        setSource('live')
        return
      }
      const presented = scenarioArtifact(scenario)
      if (!presented) {
        setError(`Scenario ${scenario.title} in ${scenarioFile} can't be shown: ${scenario.error ?? 'it has no extraction'}`)
        setPanelRequest({tab: 'diagnostics', at: Date.now()})
        return
      }
      setError(null)
      setArtifact(presented)
      setArtifactMarks({a: presented.before, b: presented.after})
      setSource('artifact')
    },
    [scenarios, scenarioFile, setSource, setError, setPanelRequest, setArtifact, setArtifactMarks],
  )
  // An edited scenarios.json updates the scenario on screen.
  const scenariosRef = useRef(scenarios)
  useEffect(() => {
    if (scenariosRef.current === scenarios) return
    scenariosRef.current = scenarios
    if (shownScenario) showScenario(shownScenario)
  }, [scenarios, shownScenario, showScenario])
  // A host's request (`InspectorHandle.showScenario`), often made as the page opens: before the definitions, the
  // projection switch or its scenarios have loaded, when showing it at once would find no scenario and show the pair.
  const loaded = Boolean(scenarioFile && scenarioLists[projection])
  useEffect(() => {
    if (!requested) return
    if (requested.projection !== projection) {
      if (projection !== requested.from) setRequested(undefined)
      return
    }
    if (!known || (scenarioFile && !loaded)) return
    setRequested(undefined)
    showScenario(requested.id)
  }, [requested, projection, known, scenarioFile, loaded, showScenario])
  const requestScenario = useCallback((request: ScenarioRequest) => setRequested(request), [])
  return {scenarios, shownScenario, showScenario, requestScenario, setScenarioVersions}
}
