import {useRef} from 'react'
import type {CSSProperties, ReactNode} from 'react'
import type {ProjectionController} from '../../projection.js'
import {ProjectionLegend} from '../../stage/legend.js'
import {utilitySide} from '../../stage/utility.js'
import {useWholePixels} from '../../stage/whole-pixels.js'
import {scopeHiddenText} from '../../scope.js'
import {Button} from '../components/button.js'
import {SummaryBar} from '../summary-bar.js'

/**
 * The legend's band look, cleared: in the foot, the foot draws the surface, and the summary bar's rule divides them.
 * Its lines are 18px, so the row is 30px and the foot's edges land on whole pixels.
 */
const legendInFoot: CSSProperties = {borderTop: 'none', background: 'transparent', lineHeight: '18px'}
/** Under a host's row the legend draws the rule between them, as the summary's and scope's rows do when not first. */
const legendUnderHost: CSSProperties = {...legendInFoot, borderTop: '1px solid var(--pj-divider)'}

/** The foot's height with only the summary's row, CSS px: the bar's 28px (no rule above it) and the foot's edge above and below. */
export const summaryFootHeight = 30

/** What the Changes scope leaves out, or nothing while another scope shows or Changes hides nothing. */
export const scopeNoticeText = (p: ProjectionController) =>
  p.comparing && p.scope === 'changes' ? scopeHiddenText(p.scopeHidden) : undefined

/**
 * Without the summary bar, which says what the scope hides, the foot's last row says it instead: "Hiding 45 unchanged
 * tables and 380 columns", with Show all (the All scope), in the summary bar's row height and text.
 */
function ScopeRow({projection: p, text}: {projection: ProjectionController; text: string}) {
  return (
    <div
      role="status"
      className="ph-scope-notice pj:flex pj:h-[calc(1.75rem_+_1px)] pj:min-w-0 pj:items-center pj:gap-2 pj:border-t pj:border-divider pj:pr-1 pj:pl-3 pj:text-xs pj:text-muted-foreground pj:first:h-7 pj:first:border-t-0"
    >
      <span className="pj:truncate">{text}</span>
      <Button type="button" variant="ghost" size="sm" className="pj:h-6 pj:shrink-0 pj:px-2 pj:text-xs" onClick={() => p.setScope('all')}>
        Show all
      </Button>
    </div>
  )
}

/**
 * The legend and the summary bar as one overlay floating at the stage's foot, centred, 12px from its bottom and sides:
 * the legend's row over the summary bar's, one 1px rule between them, one edge and radius around both, in the stage's
 * overlay look (`--ph-utility-*`, glass where supported). As wide as its longer row, the shorter centred in it, at
 * most the stage less its insets; on whole pixels. The summary bar fits its figures to that room, its "…" at its row's
 * end, and its popover opens above the whole foot. Over the renderer it covers the frames (`data-stage-cover`), so they
 * keep clear of it (`stage-inset-bottom`); over the table or text view, the view pads its end instead. Without the
 * summary, `scope` puts what the Changes scope hides in its last row (`ScopeRow`), so it never overlaps the legend.
 */
export function StageFoot({
  projection: p,
  summary,
  legend,
  scope = false,
  host,
}: {
  projection: ProjectionController
  summary: boolean
  legend: boolean
  scope?: boolean
  /** The host's own content (`ProjectionViewProps.foot`), the foot's first row; the row after it draws the rule between. */
  host?: ReactNode
}) {
  const room = useRef<HTMLDivElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  useWholePixels(foot, {width: true})
  // Mounted even while empty (hidden), so a legend that arrives later is measured and sent as a cover at once.
  const scoped = scope && !summary ? scopeNoticeText(p) : undefined
  const empty = !host && !summary && !scoped && !(legend && p.legend?.items.length)
  return (
    <div
      ref={room}
      hidden={empty}
      className="ph-stage-foot-room"
      style={{
        position: 'absolute',
        insetInline: utilitySide,
        bottom: utilitySide,
        zIndex: 3,
        display: empty ? 'none' : 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        ref={foot}
        className="ph-stage-foot"
        data-stage-cover=""
        style={{
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          width: 'max-content',
          maxWidth: '100%',
          overflow: 'hidden',
          pointerEvents: 'auto',
          border: 'var(--ph-utility-border, 1px solid var(--pj-divider))',
          borderRadius: 'var(--ph-utility-radius, var(--projections-radius, 8px))',
          background: 'var(--ph-utility-bg, var(--pj-surface-header))',
          backdropFilter: 'var(--ph-utility-backdrop, none)',
          WebkitBackdropFilter: 'var(--ph-utility-backdrop, none)',
        }}
      >
        {host && <div className="ph-stage-foot-host pj:min-w-0">{host}</div>}
        {legend && <ProjectionLegend projection={p} style={host ? legendUnderHost : legendInFoot} />}
        {summary && <SummaryBar projection={p} room={room} anchor={foot} className="pj:bg-transparent pj:first:h-7 pj:first:border-t-0" />}
        {scoped && <ScopeRow projection={p} text={scoped} />}
      </div>
    </div>
  )
}
