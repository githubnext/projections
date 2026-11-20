import {useRef} from 'react'
import type {CSSProperties} from 'react'
import type {ProjectionController} from '../../projection.js'
import {ProjectionLegend} from '../../stage/legend.js'
import {utilitySide} from '../../stage/utility.js'
import {useWholePixels} from '../../stage/whole-pixels.js'
import {SummaryBar} from '../summary-bar.js'

/**
 * The legend's band look, cleared: in the foot, the foot draws the surface, and the summary bar's rule divides them.
 * Its lines are 18px, so the row is 30px and the foot's edges land on whole pixels.
 */
const legendInFoot: CSSProperties = {borderTop: 'none', background: 'transparent', lineHeight: '18px'}

/** The foot's height with only the summary's row, CSS px: the bar's 28px (no rule above it) and the foot's edge above and below. */
export const summaryFootHeight = 30

/**
 * The legend and the summary bar as one overlay floating at the stage's foot, centred, 12px from its bottom and sides:
 * the legend's row over the summary bar's, one 1px rule between them, one edge and radius around both, in the stage's
 * overlay look (`--ph-utility-*`, glass where supported). As wide as its longer row, the shorter centred in it, at
 * most the stage less its insets; on whole pixels. The summary bar fits its figures to that room, its "…" at its row's
 * end, and its popover opens above the whole foot. Over the renderer it covers the frames (`data-stage-cover`), so they
 * keep clear of it (`stage-inset-bottom`); over the table or text view, the view pads its end instead.
 */
export function StageFoot({projection: p, summary, legend}: {projection: ProjectionController; summary: boolean; legend: boolean}) {
  const room = useRef<HTMLDivElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  useWholePixels(foot, {width: true})
  // Mounted even while empty (hidden), so a legend that arrives later is measured and sent as a cover at once.
  const empty = !summary && !(legend && p.legend?.items.length)
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
        {legend && <ProjectionLegend projection={p} style={legendInFoot} />}
        {summary && <SummaryBar projection={p} room={room} anchor={foot} className="pj:bg-transparent pj:first:h-7 pj:first:border-t-0" />}
      </div>
    </div>
  )
}
