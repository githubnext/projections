import {useRef} from 'react'
import {flushSync} from 'react-dom'
import {nothingHiddenTitle, scopeHiddenText} from '@githubnext/projections-host'
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
  // Every item is a change or gives one context: Changes and All show the same, so there is nothing to switch.
  if (!p.scopeCounts.hidden && p.scope !== 'noise')
    return (
      <span className="phv-scope-note" title={nothingHiddenTitle} data-scope="none">
        <span className="phv-scope-note-name">Changes</span>
        <span className="phv-scope-count">{p.scopeCounts.changes.toLocaleString()}</span>
        <span aria-hidden="true">·</span>
        nothing hidden
      </span>
    )
  const scopes: ViewScope[] = p.scope === 'noise' ? ['changes', 'all', 'noise'] : ['changes', 'all']
  const index = Math.max(0, scopes.indexOf(p.scope))
  // Every count takes the widest one's digits, so the switch (centred in the toolbar) keeps its width as counts change.
  const digits = Math.max(...scopes.map(scope => p.scopeCounts[scope].toLocaleString().length))
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
            <span aria-hidden="true" className="phv-scope-count" style={{minWidth: `${digits}ch`}}>
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * What the Changes scope leaves out, floating over the bottom of the stage so it never moves the layout: "Hiding 45
 * unchanged tables and 380 columns · Show all". Nothing while another scope shows, or when Changes hides nothing.
 */
export function ScopeNotice({projection: p}: {projection: ProjectionController}) {
  const text = p.comparing && p.scope === 'changes' ? scopeHiddenText(p.scopeHidden) : undefined
  if (!text) return null
  return (
    <div className="phv-scope-notice-slot">
      <div className="phv-scope-notice" role="status">
        <span className="phv-scope-notice-text">{text}</span>
        <button type="button" className="phv-scope-notice-action" onClick={() => p.setScope('all')}>
          Show all
        </button>
      </div>
    </div>
  )
}
