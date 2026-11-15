import {ChangeStatus} from '@githubnext/projections-renderer-kit/react'
import {DiffValue} from './diff.js'
import {Bar, Delta} from './marks.js'
import type {RowPresentation} from './presentation.js'
import type {Series} from './series.js'

/** One row's label, bar and value. */
function BarRow({item, scale, p}: {item: Series; scale: number; p: RowPresentation}) {
  const {diff, noun, count, number, value, labelText} = p
  const emphasis = p.emphasisOf(item)
  const delta = item.after - item.before
  return (
    <>
      <span className="stat-label pk-diff-text" title={labelText(item)}>
        {item.previousLabel && <del className="stat-was-label">{item.previousLabel}</del>}
        {item.label}
      </span>
      <span className="stat-track">
        <Bar
          value={value(item)}
          before={item.before}
          after={item.after}
          scale={scale}
          color={item.color}
          category={item.id}
          emphasis={emphasis}
          diff={diff}
        />
      </span>
      {diff ? (
        <DiffValue before={item.before} after={item.after} removed={item.change === 'removed'} noun={noun} count={count} format={number} />
      ) : (
        <span className="stat-value">
          <span className="stat-count">{count(value(item))}</span>
          <span className="stat-delta">
            <Delta delta={delta} emphasis={emphasis} noun={noun} format={number} />
          </span>
        </span>
      )}
    </>
  )
}

/** The bar chart: one row per series, scaled to the largest count of either revision. */
export function BarsChart({shown, scale, p}: {shown: readonly Series[]; scale: number; p: RowPresentation}) {
  const {diff, noun, selectedId, onSelect, labelText, counted, described, region} = p
  return (
    <div className="statistics-bars" role="group" aria-label={`${noun} by ${p.grouping}`}>
      {shown.map(item => {
        const description = `${labelText(item)}, ${counted(item)}${described(item)}`
        const row = <BarRow item={item} scale={scale} p={p} />
        return (
          <div
            key={item.id}
            className={`stat-slot ${item.size < 1 ? 'collapsing' : ''}`}
            data-statistics-id={item.id}
            style={{gridTemplateRows: `${item.size}fr`, opacity: item.presence}}
            aria-hidden={item.presence < 0.02}
          >
            <div className="stat-slot-inner">
              <div
                className={`stat-row${diff ? ' pk-region' : ''}${selectedId === item.id ? ' selected' : ''}`}
                data-entity-id={item.entity ? item.id : undefined}
                {...region(item)}
              >
                {item.entity ? (
                  <button
                    type="button"
                    className="stat-hit"
                    aria-label={`Inspect ${description}`}
                    aria-pressed={selectedId === item.id}
                    tabIndex={item.presence < 0.02 ? -1 : 0}
                    onClick={() => onSelect(item.id)}
                  >
                    {row}
                  </button>
                ) : (
                  <span className="stat-hit" role="img" aria-label={description}>
                    {row}
                  </span>
                )}
                <ChangeStatus change={p.rowStatus(item)} emphasis={p.rowStatusEmphasis(item)} className="stat-status" />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
