import type {ProjectionController} from '../projection.js'
import {scopeHiddenText} from '../scope.js'
import {Button} from './components/button.js'

/**
 * What the Changes scope leaves out, floating over the bottom of the stage so it never moves the layout: "Hiding 45
 * unchanged tables and 380 columns", with Show all (the All scope). Nothing while another scope shows, or when Changes
 * hides nothing.
 */
export function ScopeNotice({projection: p}: {projection: ProjectionController}) {
  const text = p.comparing && p.scope === 'changes' ? scopeHiddenText(p.scopeHidden) : undefined
  if (!text) return null
  return (
    // A full-width row centres the pill on whole pixels; only the pill takes the pointer.
    <div className="ph-scope-notice pj:pointer-events-none pj:absolute pj:inset-x-3 pj:bottom-3 pj:z-10 pj:flex pj:justify-center">
      <div
        role="status"
        className="pj:pointer-events-auto pj:flex pj:h-8 pj:min-w-0 pj:items-center pj:gap-2 pj:rounded-full pj:border pj:border-divider pj:bg-surface-raised pj:pr-1 pj:pl-3 pj:text-xs pj:text-muted-foreground pj:shadow-sm"
      >
        <span className="pj:truncate">{text}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="pj:h-6 pj:shrink-0 pj:rounded-full pj:px-2 pj:text-xs"
          onClick={() => p.setScope('all')}
        >
          Show all
        </Button>
      </div>
    </div>
  )
}
