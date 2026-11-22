import {useLayoutEffect, useRef} from 'react'
import type {KeyboardEvent} from 'react'
import {rovingIndex, scopeChoice, scopeHiddenText} from '@githubnext/projections-host'
import type {ProjectionController} from '@githubnext/projections-host'

/**
 * The scope, beside the mode switch and like it a radio group (arrows move and choose, the checked one is in the tab
 * order): Changes and All, their counts in the tooltip ("… (4)"), and Noise while it is the scope. When the Changes
 * scope hides nothing, a note says so instead ("Changes · nothing hidden"), in the same room. Hidden unless comparing.
 */
export function ScopeSwitch({projection: p}: {projection: ProjectionController}) {
  const group = useRef<HTMLDivElement>(null)
  // The scope chosen with the keyboard, focused once it is drawn checked (and in the tab order).
  const focusing = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const scope = focusing.current
    if (scope === undefined) return
    focusing.current = undefined
    group.current?.querySelector<HTMLButtonElement>(`[data-scope="${scope}"]`)?.focus()
  })
  if (!p.comparing) return null
  // Every item is a change or gives one context: Changes and All show the same, so there is nothing to switch.
  const {nothingHidden, noteTitle, options} = scopeChoice(p)
  const scopes = options.map(option => option.scope)
  const index = Math.max(0, scopes.indexOf(p.scope))
  const choose = (next: number) => {
    const scope = scopes[(next + scopes.length) % scopes.length]!
    focusing.current = scope
    p.setScope(scope)
  }
  const keys = (event: KeyboardEvent) => {
    const next = rovingIndex(event.key, index, scopes.length)
    if (next === undefined) return
    event.preventDefault()
    choose(next)
  }
  // Both forms share one cell, the other one invisible, so the slot keeps its width when the form changes.
  return (
    <span className="phv-scope-slot">
      <span
        className="phv-scope-note"
        title={noteTitle}
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
      >
        {options.map(({scope, label, title}, position) => (
          <button
            key={scope}
            type="button"
            role="radio"
            aria-checked={p.scope === scope}
            title={title}
            tabIndex={position === index ? 0 : -1}
            className="phv-scope"
            data-scope={scope}
            onClick={() => p.setScope(scope)}
            onKeyDown={keys}
          >
            {label}
          </button>
        ))}
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
