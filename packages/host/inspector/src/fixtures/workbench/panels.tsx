import {Button, cn} from '@githubnext/projections-host/ui/components'
import {ListChecks, LoaderCircle} from 'lucide-react'
import {Empty} from '../../shell/panels.js'
import type {FixtureScenario} from '../../types.js'
import {ChecksList} from './checks.js'
import type {ScenarioChecks} from './checks.js'
import type {extractionChoices} from './catalog.js'
import {plural} from '../../plural.js'

/** The Checks panel: run the built-in checks on this scenario or every one, rerun on change, and the results. */
export function ChecksPanel({
  scenario,
  scenarioChecks,
  failed,
  runSelected,
  checkAll,
  checkingAll,
  autoRun,
  setAutoRun,
}: {
  scenario: FixtureScenario | undefined
  scenarioChecks: ScenarioChecks | undefined
  failed: number
  runSelected: () => void
  checkAll: () => Promise<void>
  checkingAll: boolean
  autoRun: boolean
  setAutoRun: (value: boolean) => void
}) {
  return (
    <div className="pj:flex pj:flex-col pj:gap-2">
      <div className="pj:flex pj:flex-wrap pj:items-center pj:gap-2">
        <Button
          type="button"
          size="sm"
          className="pj:h-7"
          onClick={runSelected}
          disabled={!scenario || Boolean(scenario.error) || Boolean(scenarioChecks?.running)}
        >
          {scenarioChecks?.running ? <LoaderCircle className="pj:animate-spin pj:motion-reduce:animate-none" /> : <ListChecks />}
          {scenarioChecks ? 'Run again' : 'Run checks'}
        </Button>
        <Button type="button" size="sm" variant="outline" className="pj:h-7" onClick={() => void checkAll()} disabled={checkingAll}>
          Check all scenarios
        </Button>
        <label className="pj:flex pj:items-center pj:gap-1.5 pj:text-xs pj:text-muted-foreground">
          <input type="checkbox" checked={autoRun} onChange={event => setAutoRun(event.target.checked)} />
          Rerun on change
        </label>
        <p role="status" className="pj:text-xs pj:text-muted-foreground">
          {scenarioChecks?.running
            ? 'Running against the live renderer…'
            : !scenarioChecks
              ? 'The invariants the renderer harness enforces, run against this renderer.'
              : failed
                ? `${plural(failed, 'check')} failed.`
                : 'Every check passed.'}
        </p>
      </div>
      <ChecksList checks={scenarioChecks} running={Boolean(scenarioChecks?.running)} />
    </div>
  )
}

/** The Extraction panel: the scenario's extractions as JSON, side by side in a comparison. */
export function ExtractionPanel({choices}: {choices: ReturnType<typeof extractionChoices>}) {
  return choices.length ? (
    <div className={cn('pj:grid pj:min-w-0 pj:gap-3', choices.length > 1 && 'pj:lg:grid-cols-2')}>
      {choices.map(choice => (
        <section key={choice.key} className="pj:flex pj:min-w-0 pj:flex-col pj:gap-1.5">
          <h3 className="pj:text-xs pj:font-semibold">{choice.label}</h3>
          <pre className="pj:overflow-auto pj:whitespace-pre-wrap pj:break-all pj:rounded-md pj:border pj:border-divider pj:bg-surface-inset pj:p-3 pj:font-mono pj:text-xs">
            {JSON.stringify(choice.extraction, null, 2)}
          </pre>
        </section>
      ))}
    </div>
  ) : (
    <Empty>No extraction.</Empty>
  )
}
