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
 * order): Changes and All, their counts in the tooltip ("… (4)"), and Noise while it is the scope. When the Changes
 * scope hides nothing, a note says so instead ("Changes · nothing hidden"), in the same room. Hidden unless comparing.
 */
export function ScopeSwitch({projection: p}: {projection: ProjectionController}) {
  const group = useRef<HTMLDivElement>(null)
  if (!p.comparing) return null
  // Every item is a change or gives one context: Changes and All show the same, so there is nothing to switch.
  const nothingHidden = !p.scopeCounts.hidden && p.scope !== 'noise'
  const scopes: ViewScope[] = p.scope === 'noise' ? ['changes', 'all', 'noise'] : ['changes', 'all']
  const index = Math.max(0, scopes.indexOf(p.scope))
  const choose = (next: number) => {
    const scope = scopes[(next + scopes.length) % scopes.length]!
    flushSync(() => p.setScope(scope))
    group.current?.querySelector<HTMLButtonElement>(`[data-scope="${scope}"]`)?.focus()
  }
  // Both forms share one cell, the other one invisible, so the slot keeps its width when the form changes.
  return (
    <span className="phv-scope-slot">
      <span
        className="phv-scope-note"
        title={nothingHiddenTitle}
        data-scope="none"
        data-inactive={!nothingHidden || undefined}
        aria-hidden={!nothingHidden || undefined}
      >
        <span className="phv-scope-note-name">Changes</span>
        <span aria-hidden="true">·</span>
        nothing hidden
      </span>
      <div
        ref={group}
        role="radiogroup"
        aria-label="Scope"
        data-inactive={nothingHidden || undefined}
        aria-hidden={nothingHidden || undefined}
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
          const {label, title} = scopeNames[scope]
          return (
            <button
              key={scope}
              type="button"
              role="radio"
              aria-checked={p.scope === scope}
              title={`${title} (${p.scopeCounts[scope].toLocaleString()})`}
              tabIndex={position === index ? 0 : -1}
              className="phv-scope"
              data-scope={scope}
              onClick={() => p.setScope(scope)}
            >
              {label}
            </button>
          )
        })}
      </div>
    </span>
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
