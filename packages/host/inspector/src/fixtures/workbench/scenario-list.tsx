import {useMemo, useState} from 'react'
import {Input, cn} from '@githubnext/projections-host/ui/components'
import {Search} from 'lucide-react'
import type {FixtureCatalog, FixtureScenario} from '../../types.js'
import {StatusIcon, summary} from './checks.js'
import type {ScenarioChecks} from './checks.js'
import {plural} from '../../plural.js'

function scenarioMeta(scenario: FixtureScenario): string {
  if (scenario.error) return 'Unavailable'
  if (scenario.subject.mode === 'extraction') return 'Single revision'
  const custom = scenario.comparator && 'rules' in scenario.comparator
  return `${scenario.subject.before.entities.length} → ${scenario.subject.after.entities.length} entities${custom ? ' · custom comparator' : ''}`
}

/** The scenario list: grouped and filterable, with each scenario's latest check outcome. */
export function ScenarioList({
  catalog,
  selected,
  onSelect,
  checks,
}: {
  catalog: FixtureCatalog
  selected: string | undefined
  onSelect: (key: string) => void
  checks: ReadonlyMap<string, ScenarioChecks>
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const result = new Map<string, FixtureScenario[]>()
    for (const scenario of catalog.scenarios) {
      if (
        needle &&
        ![scenario.title, scenario.key, scenario.group, scenario.description ?? ''].some(text => text.toLowerCase().includes(needle))
      )
        continue
      result.set(scenario.group, [...(result.get(scenario.group) ?? []), scenario])
    }
    return [...result]
  }, [catalog, needle])
  return (
    <div className="pj:flex pj:min-h-0 pj:flex-1 pj:flex-col">
      <div className="pj:relative pj:p-1.5">
        <Search
          aria-hidden="true"
          className="pj:pointer-events-none pj:absolute pj:left-3.5 pj:top-3.5 pj:h-3.5 pj:w-3.5 pj:text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Filter scenarios"
          placeholder={`Filter ${plural(catalog.scenarios.length, 'scenario')}`}
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="pj:h-7 pj:pl-7 pj:text-xs pj:md:text-xs"
        />
      </div>
      <nav aria-label="Scenarios" className="pj:flex pj:min-h-0 pj:flex-1 pj:flex-col pj:gap-2 pj:overflow-y-auto pj:px-1.5 pj:pb-3">
        {!groups.length && (
          <p className="pj:px-2 pj:text-xs pj:text-muted-foreground">
            {catalog.scenarios.length ? 'No scenario matches.' : 'No scenarios were loaded.'}
          </p>
        )}
        {groups.map(([group, scenarios]) => (
          <section key={group} aria-label={group} className="pj:flex pj:flex-col pj:gap-px">
            <h2 className="pj:flex pj:h-6 pj:items-center pj:px-1.5 pj:text-[11px] pj:font-semibold pj:text-muted-foreground">{group}</h2>
            <ul className="pj:flex pj:flex-col pj:gap-px">
              {scenarios.map(scenario => {
                const status = summary(checks.get(scenario.key))
                return (
                  <li key={scenario.key}>
                    <button
                      type="button"
                      data-scenario={scenario.key}
                      aria-current={selected === scenario.key ? 'page' : undefined}
                      onClick={() => onSelect(scenario.key)}
                      className="pj:flex pj:w-full pj:items-center pj:gap-2 pj:rounded-md pj:px-1.5 pj:py-1 pj:text-left pj:text-xs pj:transition-colors pj:hover:bg-muted/60 pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring pj:aria-[current=page]:bg-accent pj:aria-[current=page]:text-accent-foreground"
                    >
                      <span className="pj:flex pj:min-w-0 pj:flex-1 pj:flex-col">
                        <span className="pj:truncate pj:font-medium">{scenario.title}</span>
                        <span
                          className={cn('pj:truncate pj:text-[11px]', scenario.error ? 'pj:text-destructive' : 'pj:text-muted-foreground')}
                        >
                          {scenarioMeta(scenario)}
                        </span>
                      </span>
                      {(status || scenario.error) && <StatusIcon status={scenario.error ? 'fail' : status} />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  )
}
