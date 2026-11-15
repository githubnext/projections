import type {ReactNode} from 'react'

/**
 * A value that changed: the old one struck through in a removed pill, then
 * the new one in an added pill, stacked (the default) or on one line with an
 * arrow. Assistive technology reads "was …, now …". A missing side shows
 * only the other pill.
 */
export function ValueChange({
  before,
  after,
  layout = 'stacked',
  className,
}: {
  before?: ReactNode
  after?: ReactNode
  layout?: 'stacked' | 'inline'
  className?: string
}) {
  const has = (value: ReactNode) => value !== undefined && value !== null && value !== false
  return (
    <span className={`pk-value-change${className ? ` ${className}` : ''}`} data-layout={layout}>
      {has(before) && (
        <del className="pk-change-pill" data-change="removed">
          <span className="sr-only">was </span>
          {before}
        </del>
      )}
      {has(before) && has(after) && layout === 'inline' && (
        <span className="pk-value-arrow" aria-hidden="true">
          →
        </span>
      )}
      {has(after) && (
        <ins className="pk-change-pill" data-change="added">
          <span className="sr-only">{has(before) ? ', now ' : 'now '}</span>
          {after}
        </ins>
      )}
    </span>
  )
}

/** One pill of a `ChangePills` list. */
export interface PillItem {
  /** React key for the pill: unique within the list and stable across renders. */
  key: string
  /** The pill's content. */
  label: ReactNode
  /** Added and removed pills carry a + or − sign and their hue; unchanged ones are plain. */
  change?: 'added' | 'removed' | 'unchanged'
  /** Makes the pill a selectable part (`data-entity-id`), activated with `onSelect`. */
  entityId?: string
}

/**
 * A list whose items arrive and leave, as pills: added ones with `+` in the
 * added hue, removed ones with `−` struck through in the removed hue, and
 * unchanged ones plain, for context. Each says its change to assistive
 * technology. Pills with an `entityId` are buttons that select it.
 */
export function ChangePills({
  items,
  label,
  onSelect,
  selectedId,
  className,
}: {
  items: readonly PillItem[]
  /** The list's accessible name. */
  label: string
  onSelect?: ((id: string) => void) | undefined
  selectedId?: string | null | undefined
  className?: string
}) {
  return (
    <ul className={`pk-change-pills${className ? ` ${className}` : ''}`} aria-label={label}>
      {items.map(item => {
        const change = item.change && item.change !== 'unchanged' ? item.change : undefined
        const content = (
          <>
            {change && (
              <span className="pk-pill-sign" aria-hidden="true">
                {change === 'added' ? '+' : '−'}
              </span>
            )}
            {change && <span className="sr-only">{change === 'added' ? 'Added: ' : 'Removed: '}</span>}
            <span className="pk-pill-label">{item.label}</span>
          </>
        )
        const selected = item.entityId !== undefined && selectedId === item.entityId
        return (
          <li key={item.key} className="pk-change-pill-item">
            {item.entityId !== undefined && onSelect ? (
              <button
                type="button"
                className={`pk-change-pill pk-part${selected ? ' selected' : ''}`}
                data-entity-id={item.entityId}
                aria-pressed={selected}
                {...(change ? {'data-change': change} : {})}
                onClick={event => {
                  event.stopPropagation()
                  onSelect(item.entityId!)
                }}
              >
                {content}
              </button>
            ) : (
              <span className="pk-change-pill" {...(change ? {'data-change': change} : {})}>
                {content}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * `ValueChange` inside SVG: one text line at `x`, `y` (the baseline) with
 * the old value struck through in the removed hue, an arrow, then the new
 * value in the added hue. Pass identifier attributes (the SDK's
 * `identifier`) for code values such as versions.
 */
export function SvgValueChange({
  before,
  after,
  x,
  y,
  anchor = 'start',
  className,
  ...rest
}: {
  before: string
  after: string
  x: number
  y: number
  anchor?: 'start' | 'middle' | 'end'
  className?: string
} & Record<`data-${string}`, string>) {
  return (
    <text x={x} y={y} textAnchor={anchor} className={`pk-svg-value-change${className ? ` ${className}` : ''}`} {...rest}>
      <tspan className="pk-svg-was">{before}</tspan>
      <tspan className="pk-svg-arrow"> → </tspan>
      <tspan className="pk-svg-now">{after}</tspan>
    </text>
  )
}
