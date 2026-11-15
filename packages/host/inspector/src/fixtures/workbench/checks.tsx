import {allChecks, checkDescriptions, checkTitles} from '@githubnext/projections-renderer-testing'
import type {CheckId, CheckResult} from '@githubnext/projections-renderer-testing'
import {cn} from '@githubnext/projections-host/ui/components'
import {CircleCheck, CircleDashed, CircleMinus, CircleX, LoaderCircle} from 'lucide-react'

/** A scenario's latest check run. */
export interface ScenarioChecks {
  /** The catalog generation the results were measured at. */
  generation: number
  results: CheckResult[]
  running: boolean
}

export function summary(checks: ScenarioChecks | undefined): 'pass' | 'fail' | 'running' | undefined {
  if (!checks) return undefined
  if (checks.running) return 'running'
  return checks.results.some(result => result.status === 'fail') ? 'fail' : 'pass'
}

export function StatusIcon({status, className}: {status: CheckResult['status'] | 'running' | 'pending' | undefined; className?: string}) {
  const shared = cn('pj:h-3.5 pj:w-3.5 pj:shrink-0', className)
  switch (status) {
    case 'pass':
      return <CircleCheck aria-label="Passed" className={cn(shared, 'pj:text-added')} />
    case 'fail':
      return <CircleX aria-label="Failed" className={cn(shared, 'pj:text-destructive')} />
    case 'skip':
      return <CircleMinus aria-label="Skipped" className={cn(shared, 'pj:text-muted-foreground')} />
    case 'running':
      return (
        <LoaderCircle
          aria-label="Running"
          className={cn(shared, 'pj:animate-spin pj:text-muted-foreground pj:motion-reduce:animate-none')}
        />
      )
    default:
      return <CircleDashed aria-label="Not run" className={cn(shared, 'pj:text-muted-foreground/60')} />
  }
}

/** The built-in checks for the selected scenario. */
export function ChecksList({checks, running}: {checks: ScenarioChecks | undefined; running: boolean}) {
  const results = new Map(checks?.results.map(result => [result.id, result]))
  return (
    <ul className="pi-checks pj:flex pj:flex-col pj:divide-y pj:rounded-md pj:border" aria-label="Built-in checks">
      {allChecks.map((id: CheckId) => {
        const result = results.get(id)
        const status = result?.status ?? (running ? 'running' : 'pending')
        return (
          <li key={id} data-check={id} data-status={result?.status ?? 'pending'} className="pj:flex pj:gap-2 pj:px-3 pj:py-1.5">
            <StatusIcon status={status} className="pj:mt-0.5" />
            <div className="pj:flex pj:min-w-0 pj:flex-1 pj:flex-col pj:gap-0.5">
              <p className="pj:flex pj:flex-wrap pj:items-baseline pj:gap-x-2 pj:text-xs pj:font-medium">
                {checkTitles[id]}
                {result && (
                  <span className="pj:text-[11px] pj:font-normal pj:text-muted-foreground">
                    {result.status === 'skip' ? 'skipped' : `${result.durationMs} ms`}
                  </span>
                )}
              </p>
              {(!result || result.status === 'pass') && <p className="pj:text-[11px] pj:text-muted-foreground">{checkDescriptions[id]}</p>}
              {result && result.status !== 'pass' && (
                <ul
                  className={cn(
                    'pj:flex pj:flex-col pj:gap-0.5 pj:text-[11px]',
                    result.status === 'fail' ? 'pj:text-destructive' : 'pj:text-muted-foreground',
                  )}
                >
                  {result.details.map((detail, index) => (
                    <li key={index} className="pj:break-words">
                      {detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const statusLabels = {pass: 'Passed', fail: 'Failed', skip: 'Skipped', running: 'Running', pending: 'Not run'} as const

/** The Explorer's Checks section: each built-in check's status for the selected scenario. */
export function CheckResults({checks}: {checks: ScenarioChecks | undefined}) {
  return (
    <ul aria-label="Check results" className="pj:flex pj:flex-col pj:gap-px pj:px-1">
      {allChecks.map((id: CheckId) => {
        const result = checks?.results.find(item => item.id === id)
        const status = result?.status ?? (checks?.running ? 'running' : 'pending')
        return (
          <li key={id} data-check={id} className="pj:flex pj:items-center pj:gap-2 pj:py-0.5 pj:text-xs">
            <span aria-hidden="true" className="pj:inline-flex">
              <StatusIcon status={status} />
            </span>
            <span className="pj:min-w-0 pj:flex-1 pj:truncate">{checkTitles[id]}</span>
            <span className="pj:shrink-0 pj:text-[11px] pj:text-muted-foreground">{statusLabels[status]}</span>
          </li>
        )
      })}
    </ul>
  )
}
