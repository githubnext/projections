// A bar planned by the headless `useFitPlan` alone, with plain controls (packages/host/core/browser/fit-plan.spec.ts).
// `?lock` keeps the plan while focus is in the bar, as the default UI's toolbar does for a control in use.
import {useRef, useState} from 'react'
import {useFitPlan} from '@githubnext/projections-host'

type Plan = 'wide' | 'narrow'
const plans: readonly Plan[] = ['wide', 'narrow']
const locking = new URLSearchParams(location.search).has('lock')

/**
 * Two plans: the wide one needs 576px (Apply, Zoom and a 400px spacer), the narrow one 276px (Apply, More and a 100px
 * spacer). Each plan mounts its own Apply, so a new plan remounts it; Zoom moves into More, where focus follows it.
 */
export function FitPlanHarness() {
  const bar = useRef<HTMLDivElement>(null)
  const [clicks, setClicks] = useState(0)
  const {plan} = useFitPlan(bar, plans, {
    key: '',
    signature: plan => plan,
    lock: (element, current) =>
      locking && element.contains(element.ownerDocument.activeElement) ? candidate => candidate === current : undefined,
    focusFallbacks: {zoom: ['more']},
  })
  const button = {width: 80, flex: 'none'} as const
  return (
    <main style={{fontFamily: 'system-ui', padding: 16}}>
      <div className="fit-sized" style={{width: 800}}>
        <div ref={bar} data-fit="row" data-plan={plan} role="toolbar" aria-label="Planned bar" style={{display: 'flex', gap: 8}}>
          <button key={`apply-${plan}`} type="button" data-focus-id="apply" style={button} onClick={() => setClicks(count => count + 1)}>
            Apply
          </button>
          {plan === 'wide' ? (
            <button type="button" data-focus-id="zoom" style={button}>
              Zoom
            </button>
          ) : (
            <button type="button" data-focus-id="more" style={button}>
              More
            </button>
          )}
          <span data-fit-min={plan === 'wide' ? 400 : 100} style={{flex: `1 0 ${plan === 'wide' ? 400 : 100}px`}} />
        </div>
      </div>
      <p>
        Clicks: <output aria-label="Clicks">{clicks}</output>
      </p>
    </main>
  )
}
