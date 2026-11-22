import {useCallback, useEffect, useRef, useState} from 'react'
import {builtinRendererDocuments} from '@githubnext/projections-host'
import {allChecks, checkTitles} from '@githubnext/projections-renderer-testing'
import type {CheckResult} from '@githubnext/projections-renderer-testing'
import type {FixtureCatalog, FixtureScenario} from '../../types.js'
import {checkScenario} from '../session.js'
import type {FixturesContext, FixturesStore} from '../session.js'
import {Stage} from '../stage.js'
import type {ScenarioChecks} from './checks.js'
import {errorText} from '../../app/errors.js'

/**
 * The built-in checks: each scenario's latest run, running one scenario or every one on the shared check stage, and
 * live reload (results measured before a change are dropped; the selected scenario reruns when asked to).
 */
export function useChecks({
  store,
  context,
  colorMode,
  catalog,
  scenario,
  autoRun,
}: {
  store: FixturesStore
  context: FixturesContext
  colorMode: 'light' | 'dark'
  catalog: FixtureCatalog
  scenario: FixtureScenario | undefined
  autoRun: boolean
}) {
  const [checks, setChecks] = useState<ReadonlyMap<string, ScenarioChecks>>(new Map())
  const [checkingAll, setCheckingAll] = useState(false)
  const stage = useRef<Stage | undefined>(undefined)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const stageRef = useCallback(
    (element: HTMLDivElement | null) => {
      stage.current?.dispose()
      stage.current = element ? new Stage(element, undefined, builtinRendererDocuments(context.builtins)) : undefined
    },
    [context],
  )

  const run = useCallback(
    (target: FixtureScenario) => {
      // Checks share one stage, so runs queue rather than interleave.
      const generation = store.catalog.generation
      setChecks(previous => new Map(previous).set(target.key, {generation, results: [], running: true}))
      const next = queue.current.then(async () => {
        const results: CheckResult[] = []
        const update = (running: boolean) =>
          setChecks(previous => new Map(previous).set(target.key, {generation, results: [...results], running}))
        try {
          if (!stage.current) throw new Error('The check stage is unavailable')
          await checkScenario(stage.current, store, context, target, {
            colorMode,
            onResult: result => {
              results.push(result)
              update(true)
            },
          })
        } catch (error) {
          results.push(
            ...allChecks
              .filter(id => !results.some(result => result.id === id))
              .map(id => ({id, title: checkTitles[id], status: 'fail' as const, details: [errorText(error)], durationMs: 0})),
          )
        }
        stage.current?.dispose()
        update(false)
      })
      queue.current = next
      return next
    },
    [store, context, colorMode],
  )
  const checkAll = useCallback(async () => {
    setCheckingAll(true)
    for (const item of store.catalog.scenarios) if (!item.error) await run(item)
    setCheckingAll(false)
  }, [run, store])

  // Live reload: results measured before a change are stale; rerun the selected scenario's checks if asked to.
  useEffect(() => {
    setChecks(previous => new Map([...previous].filter(([, value]) => value.generation === catalog.generation || value.running)))
    if (autoRun && scenario && !scenario.error) void run(scenario)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the catalog or the selection changes.
  }, [catalog.generation, scenario?.key, autoRun])

  return {checks, run, checkAll, checkingAll, stageRef}
}
