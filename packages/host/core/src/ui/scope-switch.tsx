import type {ViewScope} from '@githubnext/projections-renderer-sdk/presentation'
import type {ProjectionController} from '../projection.js'
import {nothingHiddenTitle} from '../scope.js'
import {SegmentedControl, SegmentedControlItem} from './components/segmented-control.js'
import {cn} from './lib/utils.js'

const scopeNames: Record<ViewScope, {label: string; title: string}> = {
  changes: {label: 'Changes', title: 'Show the changes and what they need to be read, folding the rest'},
  all: {label: 'All', title: 'Show every item'},
  noise: {label: 'Noise', title: 'Show only the items that varied within tolerance or were regenerated'},
}

/**
 * The "Scope" radio group (arrow keys select): Changes and All, each with its count ("Changes 4", "All 82"), and
 * Noise while it is the scope (chosen from Settings or the summary bar). When the Changes scope hides nothing, a note
 * says so instead ("Changes 2 · nothing hidden"), in the same room. Hidden unless comparing.
 */
export function ScopeSwitch({projection: p}: {projection: ProjectionController}) {
  if (!p.comparing) return null
  // Every item is a change or gives one context: Changes and All show the same, so there is nothing to switch.
  const nothingHidden = !p.scopeCounts.hidden && p.scope !== 'noise'
  const scopes: ViewScope[] = p.scope === 'noise' ? ['changes', 'all', 'noise'] : ['changes', 'all']
  // Every count takes the widest one's digits, so the switch (centred in the toolbar) keeps its width as counts change.
  const digits = Math.max(...scopes.map(scope => p.scopeCounts[scope].toLocaleString().length))
  // Both forms share one cell, the other one invisible, so the slot keeps its width when the form changes.
  const form = (shown: boolean) => cn('pj:col-start-1 pj:row-start-1', !shown && 'pj:invisible')
  return (
    <span className="ph-scope-slot pj:inline-grid pj:shrink-0 pj:items-center pj:justify-items-start">
      <span
        className={cn(
          'ph-scope ph-scope-note pj:inline-flex pj:h-8 pj:shrink-0 pj:items-center pj:gap-1.5 pj:px-2 pj:text-sm pj:text-muted-foreground',
          form(nothingHidden),
        )}
        title={nothingHiddenTitle}
        data-scope="none"
        aria-hidden={!nothingHidden || undefined}
      >
        <span className="pj:font-medium pj:text-foreground">Changes</span>
        <span className="pj:text-xs pj:tabular-nums">{p.scopeCounts.changes.toLocaleString()}</span>
        <span aria-hidden="true">·</span>
        <span>nothing hidden</span>
      </span>
      <SegmentedControl
        aria-label="Scope"
        aria-hidden={nothingHidden || undefined}
        value={p.scope}
        onValueChange={value => p.setScope(value as ViewScope)}
        className={cn('ph-scope pj:shrink-0', form(!nothingHidden))}
      >
        {scopes.map(scope => {
          const count = p.scopeCounts[scope].toLocaleString()
          const {label, title} = scopeNames[scope]
          return (
            <SegmentedControlItem
              key={scope}
              value={scope}
              data-scope={scope}
              title={`${title} (${count})`}
              aria-label={`${label}, ${count}`}
              className="pj:gap-1.5 pj:px-2"
            >
              <span className="ph-scope-label">{label}</span>
              <span
                aria-hidden="true"
                style={{minWidth: `${digits}ch`}}
                className="ph-scope-count pj:text-start pj:text-xs pj:tabular-nums pj:text-muted-foreground"
              >
                {count}
              </span>
            </SegmentedControlItem>
          )
        })}
      </SegmentedControl>
    </span>
  )
}
