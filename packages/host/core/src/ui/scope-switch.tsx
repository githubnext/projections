import type {ViewScope} from '@githubnext/projections-renderer-sdk/presentation'
import type {ProjectionController} from '../projection.js'
import {SegmentedControl, SegmentedControlItem} from './components/segmented-control.js'
import {cn} from './lib/utils.js'

const scopeNames: Record<ViewScope, {label: string; title: string}> = {
  changes: {label: 'Changes', title: 'Show the changes and what they need to be read, folding the rest'},
  all: {label: 'All', title: 'Show every item'},
  noise: {label: 'Noise', title: 'Show only the items that varied within tolerance or were regenerated'},
}

/**
 * The "Scope" radio group (arrow keys select): Changes and All, each with its count ("Changes 4", "All 82"), and
 * Noise while it is the scope (chosen from Settings or the summary bar). `compact` drops the counts, which stay in each
 * item's tooltip and accessible name. Hidden unless comparing.
 */
export function ScopeSwitch({projection: p, compact = false}: {projection: ProjectionController; compact?: boolean}) {
  if (!p.comparing) return null
  const scopes: ViewScope[] = p.scope === 'noise' ? ['changes', 'all', 'noise'] : ['changes', 'all']
  return (
    <SegmentedControl
      aria-label="Scope"
      value={p.scope}
      onValueChange={value => p.setScope(value as ViewScope)}
      className="ph-scope pj:shrink-0"
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
              className={cn('ph-scope-count pj:text-xs pj:tabular-nums pj:text-muted-foreground', compact && 'pj:hidden')}
            >
              {count}
            </span>
          </SegmentedControlItem>
        )
      })}
    </SegmentedControl>
  )
}
