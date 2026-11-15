import {useCallback, useEffect, useMemo, useState, useSyncExternalStore} from 'react'
import type {ComputedComparison} from '@githubnext/projections-host'
import {cn} from '@githubnext/projections-host/ui/components'
import {ListChecks} from 'lucide-react'
import type {FixtureScenario} from '../types.js'
import {Shell, iconButton, shortcutLabel} from '../shell/shell.js'
import type {Command, PanelTab} from '../shell/shell.js'
import {ChangesTable, DiagnosticsList} from '../shell/panels.js'
import {useTheme} from '../shell/theme.js'
import {Explorer} from '../shell/explorer.js'
import {scenarioRenderer, scenarioRenderers, scenarioSubject} from './model.js'
import type {FixturesContext, FixturesStore} from './session.js'
import {WorkbenchBody} from './workbench/body.js'
import {annotationsFor, catalogDiagnostics, extractionChoices, viewports} from './workbench/catalog.js'
import type {Viewport} from './workbench/catalog.js'
import {CheckResults} from './workbench/checks.js'
import {CenterTitle, WorkbenchStatus, WorkbenchTitle} from './workbench/chrome.js'
import {ChecksPanel, ExtractionPanel} from './workbench/panels.js'
import {ScenarioList} from './workbench/scenario-list.js'
import {useChecks} from './workbench/use-checks.js'

const params = new URLSearchParams(location.search)

export interface FixturesWorkbenchProps {
  store: FixturesStore
  context: FixturesContext
}

/**
 * The Inspector's fixtures mode: develop a renderer or comparator against
 * scenario fixtures in the real host view, with live reload and the built-in
 * checks, in the same workbench as the repository Inspector.
 */
export function FixturesWorkbench({store, context}: FixturesWorkbenchProps) {
  const catalog = useSyncExternalStore(store.subscribe, store.snapshot)
  const theme = useTheme()
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [selectedKey, setSelectedKey] = useState(params.get('scenario') ?? '')
  const scenario =
    catalog.scenarios.find(item => item.key === selectedKey) ??
    catalog.scenarios.find(item => item.id === selectedKey) ??
    catalog.scenarios[0]
  const [computed, setComputed] = useState<{scenario: FixtureScenario; result?: ComputedComparison; error?: unknown}>()
  const [autoRun, setAutoRun] = useState(false)
  const [panelTab, setPanelTab] = useState('checks')
  const [panelRequest, setPanelRequest] = useState<{tab: string; at: number}>()

  useEffect(() => {
    if (!scenario) return
    const url = new URL(location.href)
    url.searchParams.set('scenario', scenario.key)
    history.replaceState(null, '', url)
  }, [scenario])

  useEffect(() => {
    if (!scenario || scenario.error || scenario.subject.mode !== 'comparison') return
    let current = true
    store.compare(scenario).then(
      result => {
        if (current) setComputed({scenario, result})
      },
      error => {
        if (current) setComputed({scenario, error})
      },
    )
    return () => {
      current = false
    }
  }, [scenario, store])

  const {checks, run, checkAll, checkingAll, stageRef} = useChecks({
    store,
    context,
    colorMode: theme.colorMode,
    catalog,
    scenario,
    autoRun,
  })
  const runSelected = useCallback(() => {
    if (!scenario || scenario.error) return
    setPanelRequest({tab: 'checks', at: Date.now()})
    void run(scenario)
  }, [scenario, run])

  const resolution = scenario && !scenario.error ? scenarioRenderer(scenario, catalog, context.builtins) : undefined
  const comparison = computed?.scenario === scenario ? computed : undefined
  const subject = useMemo(
    () => (scenario && !scenario.error ? scenarioSubject(scenario, comparison?.result) : undefined),
    [scenario, comparison?.result],
  )
  const annotations = useMemo(() => (subject && params.has('annotate') ? annotationsFor(subject) : undefined), [subject])
  const renderers = useMemo(
    () => (scenario && !scenario.error ? scenarioRenderers(scenario, catalog, context.builtins, resolution?.renderer) : []),
    [scenario, catalog, context.builtins, resolution?.renderer],
  )
  const width = viewports[viewport].width
  const scenarioChecks = scenario ? checks.get(scenario.key) : undefined
  const runningKey = [...checks].find(([, value]) => value.running)?.[0]
  const running = runningKey ? catalog.scenarios.find(item => item.key === runningKey) : undefined
  const failed = scenarioChecks?.results.filter(result => result.status === 'fail').length ?? 0
  const diagnostics = catalogDiagnostics(catalog)
  const choices = extractionChoices(scenario)

  // A broken scenario file is the first thing to see.
  const problems = diagnostics.length
  useEffect(() => {
    if (problems) setPanelRequest({tab: 'diagnostics', at: Date.now()})
  }, [problems])

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'checks.run',
        group: 'Checks',
        label: 'Run the built-in checks on this scenario',
        shortcut: shortcutLabel('e'),
        disabled: !scenario || Boolean(scenario.error),
        run: runSelected,
      },
      {
        id: 'checks.all',
        group: 'Checks',
        label: 'Run the built-in checks on every scenario',
        disabled: checkingAll,
        run: () => void checkAll(),
      },
      {
        id: 'checks.auto',
        group: 'Checks',
        label: `${autoRun ? 'Stop running' : 'Run'} the checks whenever a file changes`,
        run: () => setAutoRun(value => !value),
      },
      ...(Object.keys(viewports) as Viewport[]).map(key => ({
        id: `viewport.${key}`,
        group: 'Viewport',
        label: `Preview at ${viewports[key].label.toLowerCase()} width`,
        run: () => setViewport(key),
      })),
      ...catalog.scenarios.map(item => ({
        id: `scenario.${item.key}`,
        group: 'Scenario',
        label: `Open ${item.title}`,
        keywords: `${item.key} ${item.group}`,
        run: () => setSelectedKey(item.key),
      })),
      ...theme.commands,
    ],
    [scenario, runSelected, checkingAll, checkAll, autoRun, catalog.scenarios, theme.commands],
  )

  const panelTabs: PanelTab[] = [
    {
      id: 'checks',
      label: 'Checks',
      badge: failed || undefined,
      tone: 'destructive',
      content: (
        <ChecksPanel
          scenario={scenario}
          scenarioChecks={scenarioChecks}
          failed={failed}
          runSelected={runSelected}
          checkAll={checkAll}
          checkingAll={checkingAll}
          autoRun={autoRun}
          setAutoRun={setAutoRun}
        />
      ),
    },
    {
      id: 'diagnostics',
      label: 'Diagnostics',
      badge: diagnostics.length || undefined,
      tone: 'destructive',
      content: <DiagnosticsList diagnostics={diagnostics} />,
    },
    {id: 'extraction', label: 'Extraction', content: <ExtractionPanel choices={choices} />},
    {id: 'changes', label: 'Changes', content: <ChangesTable comparison={comparison?.result} beforeLabel="Before" afterLabel="After" />},
  ]

  return (
    <Shell
      colorMode={theme.colorMode}
      center={<CenterTitle scenario={scenario} />}
      title={
        <WorkbenchTitle
          viewport={viewport}
          setViewport={setViewport}
          scenario={scenario}
          running={running}
          runSelected={runSelected}
          connected={store.connected}
          theme={theme}
        />
      }
      titleKey={scenario?.key ?? ''}
      sidebarLabel="Explorer"
      sidebar={
        <Explorer
          label="Explorer"
          scope="fixtures"
          sections={[
            {
              id: 'scenarios',
              title: 'Scenarios',
              children: <ScenarioList catalog={catalog} selected={scenario?.key} onSelect={setSelectedKey} checks={checks} />,
            },
            {
              id: 'checks',
              title: 'Checks',
              actions: (
                <button
                  type="button"
                  className={cn(iconButton, 'pj:h-6 pj:w-6')}
                  aria-label="Show the Checks panel"
                  title="Show the Checks panel"
                  onClick={() => setPanelRequest({tab: 'checks', at: Date.now()})}
                >
                  <ListChecks className="pj:h-3.5 pj:w-3.5" />
                </button>
              ),
              children: <CheckResults checks={scenarioChecks} />,
            },
          ]}
        />
      }
      panelTabs={panelTabs}
      panelTab={panelTab}
      onPanelTab={setPanelTab}
      panelRequest={panelRequest}
      status={
        <WorkbenchStatus
          catalog={catalog}
          scenario={scenario}
          resolution={resolution}
          comparison={comparison}
          scenarioChecks={scenarioChecks}
          failed={failed}
        />
      }
      commands={commands}
      data-fixtures-workbench=""
      data-generation={catalog.generation}
      data-mode="fixtures"
    >
      <WorkbenchBody
        catalog={catalog}
        scenario={scenario}
        comparison={comparison}
        subject={subject}
        resolution={resolution}
        renderers={renderers}
        annotations={annotations}
        colorMode={theme.colorMode}
        viewport={viewport}
        width={width}
        running={running}
        stageRef={stageRef}
      />
    </Shell>
  )
}
