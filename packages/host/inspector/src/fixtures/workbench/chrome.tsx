import {rendererProtocolVersion} from '@githubnext/projections-host'
import type {ComputedComparison} from '@githubnext/projections-host'
import {cn} from '@githubnext/projections-host/ui/components'
import {ListChecks, LoaderCircle} from 'lucide-react'
import {StatusItem, TitleSettings, iconButton, shortcutLabel} from '../../shell/shell.js'
import type {useTheme} from '../../shell/theme.js'
import type {FixtureCatalog, FixtureScenario} from '../../types.js'
import type {scenarioRenderer} from '../model.js'
import {viewports} from './catalog.js'
import type {Viewport} from './catalog.js'
import type {ScenarioChecks} from './checks.js'
import {plural} from '../../plural.js'

/** The scenario is the document: its name is the title bar's centred title (the Explorer's Scenarios switch it). */
export function CenterTitle({scenario}: {scenario: FixtureScenario | undefined}) {
  return (
    <span
      data-center-title=""
      className="pi-document-title pj:min-w-0 pj:truncate pj:px-1.5 pj:text-[13px] pj:font-semibold pj:tracking-tight"
      title={[scenario ? `${scenario.group} / ${scenario.title}` : 'No scenario', scenario?.description].filter(Boolean).join(': ')}
    >
      {scenario ? `${scenario.group} / ${scenario.title}` : 'No scenario'}
    </span>
  )
}

/** The title bar's controls: the viewport, Run checks, the live reload connection and the settings. */
export function WorkbenchTitle({
  viewport,
  setViewport,
  scenario,
  running,
  runSelected,
  connected,
  theme,
}: {
  viewport: Viewport
  setViewport: (viewport: Viewport) => void
  scenario: FixtureScenario | undefined
  running: FixtureScenario | undefined
  runSelected: () => void
  connected: boolean
  theme: ReturnType<typeof useTheme>
}) {
  return (
    <>
      <div role="radiogroup" aria-label="Viewport" className="pj:flex pj:shrink-0 pj:items-center pj:gap-px">
        {(Object.keys(viewports) as Viewport[]).map(key => {
          const Icon = viewports[key].icon
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={viewport === key}
              aria-label={viewports[key].label}
              className={cn(iconButton, 'pj:aria-checked:bg-muted pj:aria-checked:text-foreground')}
              title={`${viewports[key].label}${viewports[key].width ? ` (${viewports[key].width}px)` : ''}`}
              onClick={() => setViewport(key)}
            >
              <Icon className="pj:h-3.5 pj:w-3.5" />
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className={cn(iconButton, 'pj:w-auto pj:gap-1 pj:px-1.5 pj:text-xs')}
        onClick={runSelected}
        disabled={!scenario || Boolean(scenario.error)}
        title={`Run checks (${shortcutLabel('e')})`}
      >
        {running ? (
          <LoaderCircle className="pj:h-3.5 pj:w-3.5 pj:animate-spin pj:motion-reduce:animate-none" />
        ) : (
          <ListChecks className="pj:h-3.5 pj:w-3.5" />
        )}
        <span className="pj:hidden pj:md:inline">Run checks</span>
      </button>
      <span
        className="pi-live pj:hidden pj:shrink-0 pj:items-center pj:gap-1.5 pj:px-1.5 pj:text-xs pj:text-muted-foreground pj:sm:inline-flex"
        data-connected={connected}
        title="Reloads when a scenario file, fixture, comparator file or renderer bundle changes"
      >
        <span aria-hidden="true" className={cn('pj:h-2 pj:w-2 pj:rounded-full', connected ? 'pj:bg-added' : 'pj:bg-modified')} />
        {connected ? 'Live' : 'Reconnecting…'}
      </span>
      <TitleSettings theme={theme.preference} onTheme={theme.setPreference} />
    </>
  )
}

/** The status bar: the scenario, its renderer and comparator, its checks, the protocol and the catalog. */
export function WorkbenchStatus({
  catalog,
  scenario,
  resolution,
  comparison,
  scenarioChecks,
  failed,
}: {
  catalog: FixtureCatalog
  scenario: FixtureScenario | undefined
  resolution: ReturnType<typeof scenarioRenderer> | undefined
  comparison: {result?: ComputedComparison} | undefined
  scenarioChecks: ScenarioChecks | undefined
  failed: number
}) {
  return (
    <>
      <StatusItem>{scenario ? <code className="pj:font-mono">{scenario.key}</code> : 'No scenario'}</StatusItem>
      {resolution?.renderer && (
        <StatusItem title={resolution.renderer.url}>
          {resolution.renderer.title} renderer{resolution.renderer.source === 'custom' ? ' (fixture bundle)' : ''}
        </StatusItem>
      )}
      {comparison?.result && (
        <StatusItem data-comparator={comparison.result.comparator.id} title={`Digest ${comparison.result.comparator.digest}`}>
          {comparison.result.comparator.id === 'default' ? 'Default comparator' : `Comparator ${comparison.result.comparator.id}`} ·{' '}
          {plural(comparison.result.comparison.steps.length, 'step')}
        </StatusItem>
      )}
      {scenarioChecks && !scenarioChecks.running && (
        <StatusItem>{failed ? `${plural(failed, 'check')} failed` : 'Checks passed'}</StatusItem>
      )}
      <span className="pj:flex-1" />
      <StatusItem title="Renderer frame protocol version">Protocol v{rendererProtocolVersion}</StatusItem>
      <StatusItem>
        {plural(catalog.scenarios.length, 'scenario')} · generation {catalog.generation}
      </StatusItem>
    </>
  )
}
