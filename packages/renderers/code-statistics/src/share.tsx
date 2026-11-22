import {ChangeStatus} from '@githubnext/projections-renderer-kit/react'
import {donutSlice} from './timeline.js'
import {Delta} from './marks.js'
import {ring, sliceSemantics, unchanged, type Arc, type RowPresentation} from './presentation.js'
import type {Series} from './series.js'

/**
 * The end of a slice carries the change so far, hatched over the slice itself: the part gained (light hatch) or the
 * share of the before count lost (dark hatch). No separate rim.
 */
function SliceChange({
  item,
  arc,
  emphasis,
  patternId,
  value,
}: {
  item: Series
  arc: Arc
  emphasis: number
  patternId: string
  value: number
}) {
  const delta = item.after - item.before
  if (!(emphasis > 0.01 && delta !== 0)) return null
  const fraction = delta > 0 ? Math.max(0, value - item.before) / (value || 1) : Math.max(0, item.before - value) / (item.before || 1)
  const portion = (arc.end - arc.start) * Math.min(1, fraction)
  if (!(portion > 0.001)) return null
  return (
    <path
      className={`stat-arc-change ${delta > 0 ? 'gain' : 'loss'}`}
      d={donutSlice(160, 120, 74, arc.end - portion, arc.end)}
      fill={`url(#${patternId}-${delta > 0 ? 'gain' : 'loss'})`}
      opacity={emphasis}
    />
  )
}

/** One series' slice of the donut. */
function Slice({item, arc, total, patternId, p}: {item: Series; arc: Arc; total: number; patternId: string; p: RowPresentation}) {
  const {noun, count, value, selectedId} = p
  const delta = item.after - item.before
  const share = total > 0 ? Math.round((value(item) / total) * 100) : 0
  return (
    <g
      className={`stat-arc ${selectedId === item.id ? 'selected' : ''} ${item.entity ? 'interactive' : ''}`}
      data-statistics-id={item.id}
      data-entity-id={item.entity ? item.id : undefined}
      {...sliceSemantics(item, p)}
      aria-label={`${item.label}, ${count(value(item))} ${noun}, ${share} percent${p.signedDelta(delta)}${p.described(item)}`}
    >
      <title>{`${item.label}: ${count(value(item))} ${noun}`}</title>
      <path
        d={donutSlice(160, 120, 74, arc.start, arc.end)}
        data-projections-edge=""
        data-projections-category={item.id}
        fill={item.color}
        opacity={item.presence}
      />
      <SliceChange item={item} arc={arc} emphasis={p.emphasisOf(item)} patternId={patternId} value={value(item)} />
    </g>
  )
}

/** The share chart: a donut of the current counts, with each row's count and change beside it. */
export function ShareChart({shown, total, patternId, p}: {shown: readonly Series[]; total: number; patternId: string; p: RowPresentation}) {
  const {noun, count, number, value, onSelect} = p
  const outer = ring(shown, value, total)
  const arcs = shown.filter(item => outer.has(item.id)).map(item => ({item, arc: outer.get(item.id)!}))
  return (
    <div className="statistics-share">
      <svg viewBox="0 0 320 320" role="group" aria-label={`Share of ${noun} by ${p.grouping}`}>
        <defs>
          <pattern id={`${patternId}-gain`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect className="stat-hatch-line gain" width="2.5" height="6" />
          </pattern>
          <pattern id={`${patternId}-loss`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect className="stat-hatch-line loss" width="2.5" height="6" />
          </pattern>
        </defs>
        {arcs.map(({item, arc}) => (
          <Slice key={item.id} item={item} arc={arc} total={total} patternId={patternId} p={p} />
        ))}
        <text x="160" y="154" textAnchor="middle" className="stat-centre-value" aria-hidden="true">
          {count(total)}
        </text>
        <text x="160" y="174" textAnchor="middle" className="stat-centre-label" aria-hidden="true">
          {noun}
        </text>
      </svg>
      <ul className="statistics-values" aria-label={`${noun} by ${p.grouping}`}>
        {shown.map(item => {
          const delta = item.after - item.before
          return (
            <li
              key={item.id}
              className={`stat-slot ${item.size < 1 ? 'collapsing' : ''}`}
              data-statistics-id={item.id}
              style={{gridTemplateRows: `${item.size}fr`, opacity: item.presence}}
              aria-hidden={item.presence < 0.02}
            >
              <div className="stat-slot-inner">
                <div className="stat-values-row" data-entity-id={item.entity ? item.id : undefined}>
                  {item.entity ? (
                    <button
                      type="button"
                      className="entity-link"
                      tabIndex={item.presence < 0.02 ? -1 : 0}
                      onClick={() => onSelect(item.id)}
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span>{item.label}</span>
                  )}
                  <span className="stat-values-value">{count(value(item))}</span>
                  <span className="stat-delta">
                    <Delta delta={delta} emphasis={p.emphasisOf(item)} noun={noun} format={number} />
                  </span>
                  <ChangeStatus change={item.entity ? item : unchanged} emphasis={p.statusEmphasis(item)} className="stat-status" />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
