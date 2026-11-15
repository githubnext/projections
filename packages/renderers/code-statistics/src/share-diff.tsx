import {ChangeStatus} from '@githubnext/projections-renderer-kit/react'
import {DiffValue} from './diff.js'
import {donutSlice} from './timeline.js'
import {ring, sliceSemantics} from './presentation.js'
import type {RowPresentation} from './presentation.js'
import type {Series} from './series.js'

const percent = (amount: number, sum: number) => (sum > 0 ? Math.round((amount / sum) * 100) : 0)

/** A row's shares of the After and Before totals, in words. */
function shares(item: Series, totalBefore: number, totalAfter: number) {
  const was = `was ${percent(item.before, totalBefore)} percent`
  if (item.change === 'removed') return was
  return `${percent(item.after, totalAfter)} percent${item.before !== item.after && item.before ? `, ${was}` : ''}`
}

interface ShareProps {
  shown: readonly Series[]
  /** The current counts' total over every series, shown or not. */
  total: number
  totalBefore: number
  totalAfter: number
  p: RowPresentation
}

/** Diff mode's paired rings, After outside and Before inside, so a removed language keeps its slice where it was. */
function Rings({shown, total, totalBefore, totalAfter, p}: ShareProps) {
  const {noun, count, selectedId, labelText, counted, described, region} = p
  const outer = ring(shown, p.value, total)
  const inner = ring(shown, item => item.before, totalBefore)
  return (
    <figure className="stat-rings">
      <svg viewBox="0 0 320 320" role="group" aria-label={`Share of ${noun} by ${p.grouping}, After and Before`}>
        {shown
          .filter(item => outer.has(item.id) || inner.has(item.id))
          .map(item => {
            const after = outer.get(item.id)
            const before = inner.get(item.id)
            return (
              <g
                key={item.id}
                className={`stat-arc${selectedId === item.id ? ' selected' : ''}${item.entity ? ' interactive' : ''}`}
                data-statistics-id={item.id}
                data-entity-id={item.entity ? item.id : undefined}
                {...region(item)}
                {...sliceSemantics(item, p)}
                aria-label={`${labelText(item)}, ${counted(item)}, ${shares(item, totalBefore, totalAfter)}${described(item)}`}
              >
                <title>{`${labelText(item)}: ${counted(item)}`}</title>
                {before && (
                  <path
                    className="stat-ring-slice before"
                    data-projections-edge=""
                    d={donutSlice(160, 84, 62, before.start, before.end)}
                    data-projections-category={item.id}
                    fill={item.color}
                  />
                )}
                {after && (
                  <path
                    className="stat-ring-slice after"
                    data-projections-edge=""
                    d={donutSlice(160, 122, 92, after.start, after.end)}
                    data-projections-category={item.id}
                    fill={item.color}
                  />
                )}
              </g>
            )
          })}
        <text x="160" y="152" textAnchor="middle" className="stat-centre-value" aria-hidden="true">
          {count(totalAfter)}
        </text>
        <text x="160" y="170" textAnchor="middle" className="stat-centre-label" aria-hidden="true">
          {noun}
        </text>
        {totalAfter - totalBefore !== 0 && (
          <text x="160" y="187" textAnchor="middle" className="stat-centre-label stat-centre-was" aria-hidden="true">
            was {count(totalBefore)}
          </text>
        )}
      </svg>
      <figcaption className="stat-rings-caption">Outer ring After, inner ring Before</figcaption>
    </figure>
  )
}

/** Diff mode's share chart: the paired rings and each row's counts. */
export function DiffShareChart(props: ShareProps) {
  const {shown, p} = props
  const {noun, count, number, selectedId, onSelect, labelText, counted, described, region} = p
  return (
    <div className="statistics-share diff">
      <Rings {...props} />
      <ul className="statistics-values" aria-label={`${noun} by ${p.grouping}`}>
        {shown.map(item => (
          <li key={item.id} className="stat-slot" data-statistics-id={item.id}>
            <div className="stat-slot-inner">
              <div
                className={`stat-values-row pk-region${selectedId === item.id ? ' selected' : ''}`}
                data-entity-id={item.entity ? item.id : undefined}
                {...region(item)}
              >
                {item.entity ? (
                  <button
                    type="button"
                    className="entity-link pk-diff-text"
                    aria-label={`Inspect ${labelText(item)}, ${counted(item)}${described(item)}`}
                    onClick={() => onSelect(item.id)}
                  >
                    {item.previousLabel && <del className="stat-was-label">{item.previousLabel}</del>}
                    {item.label}
                  </button>
                ) : (
                  <span className="pk-diff-text">{item.label}</span>
                )}
                <DiffValue
                  before={item.before}
                  after={item.after}
                  removed={item.change === 'removed'}
                  noun={noun}
                  count={count}
                  format={number}
                />
                <ChangeStatus change={p.rowStatus(item)} emphasis={p.rowStatusEmphasis(item)} className="stat-status" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
