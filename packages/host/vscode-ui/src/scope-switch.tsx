import {useRef} from 'react'
import {flushSync} from 'react-dom'
import type {ProjectionController, ViewScope} from '@githubnext/projections-host'

const scopeNames: Record<ViewScope, {label: string; title: string}> = {
  changes: {label: 'Changes', title: 'Show the changes and what they need to be read, folding the rest'},
  all: {label: 'All', title: 'Show every item'},
  noise: {label: 'Noise', title: 'Show only the items that varied within tolerance or were regenerated'},
}

/**
 * The scope, beside the mode switch and like it a radio group (arrows move and choose, the checked one is in the tab
 * order): Changes and All with their counts ("Changes 4", "All 82"), and Noise while it is the scope. Hidden unless comparing.
 */
export function ScopeSwitch({projection: p}: {projection: ProjectionController}) {
  const group = useRef<HTMLDivElement>(null)
  if (!p.comparing) return null
  const scopes: ViewScope[] = p.scope === 'noise' ? ['changes', 'all', 'noise'] : ['changes', 'all']
  const index = Math.max(0, scopes.indexOf(p.scope))
  const choose = (next: number) => {
    const scope = scopes[(next + scopes.length) % scopes.length]!
    flushSync(() => p.setScope(scope))
    group.current?.querySelector<HTMLButtonElement>(`[data-scope="${scope}"]`)?.focus()
  }
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="Scope"
      className="phv-scope-switch"
      onKeyDown={event => {
        const step =
          event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
        const edge = event.key === 'Home' ? 0 : event.key === 'End' ? scopes.length - 1 : undefined
        if (!step && edge === undefined) return
        event.preventDefault()
        choose(edge ?? index + step)
      }}
    >
      {scopes.map((scope, position) => {
        const count = p.scopeCounts[scope].toLocaleString()
        const {label, title} = scopeNames[scope]
        return (
          <button
            key={scope}
            type="button"
            role="radio"
            aria-checked={p.scope === scope}
            aria-label={`${label}, ${count}`}
            title={`${title} (${count})`}
            tabIndex={position === index ? 0 : -1}
            className="phv-scope"
            data-scope={scope}
            onClick={() => p.setScope(scope)}
          >
            {label}
            <span aria-hidden="true" className="phv-scope-count">
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
