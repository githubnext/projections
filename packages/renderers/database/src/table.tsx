import type {CSSProperties, MouseEvent, ReactNode} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import {identifier, type EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {changeMark, classifyChange, describeChange, isChanged, isFold} from '@githubnext/projections-renderer-kit'
import {ChangeStatus, ValueChange, type RendererProps} from '@githubnext/projections-renderer-kit/react'
import {Breakable} from './measure.js'
import {textMetrics} from './text.js'
import type {ChangeLine} from './change-lines.js'
import {baseType, columnType, declaredType} from './types.js'
import type {FrameColumn, SchemaFrame} from './frame.js'
import {ChangeLines, describeColumn, GlyphStatus, oneLine, type Wrap} from './row-parts.js'
import {placeAttributes, rowPlaces, type RowPlace} from './row-edges.js'

/** What every row of one card is drawn with. */
interface Card {
  props: RendererProps
  diff: boolean
  wrap: Wrap
  /** The card's own change. */
  change: EntityChange<Entity>
  /** Rows of a wholly added or removed table share its status rather than repeating it; the diff marks every row. */
  survives: boolean
  rowBadges: boolean
  /** The top of the card's first key row. */
  firstKey: number
  /** `pk-diff-text` in the diff, so text takes the diff's colours. */
  text: string
  /** Each row's place in the card (`rowPlaces`). */
  places: Map<string, RowPlace>
}

const select = (props: RendererProps, id: string) => (event: MouseEvent) => {
  event.stopPropagation()
  props.onSelect(id)
}

/**
 * A row's change mark in the diff: tinted as a region in a card of both revisions (a wholly added or removed
 * card is tinted itself), and as tall as its change lines.
 */
function mark(card: Card, row: EntityChange<Entity>, lines: readonly ChangeLine[] | undefined, rowEmphasis: number) {
  const {diff, survives} = card
  const place = placeAttributes(card.places.get(row.id))
  return diff
    ? {
        attributes: {...changeMark(row), ...place},
        className: `${survives && isChanged(row) ? ' pk-region' : ''}${lines ? ' database-spanning' : ''}`,
        style: {'--emphasis': rowEmphasis} as CSSProperties,
      }
    : {attributes: place, className: '', style: {}}
}

/** A row's own slot, then its change lines, each in its slot. */
function content(
  {wrap}: Card,
  inner: ReactNode,
  lines: readonly ChangeLine[] | undefined,
  shown: readonly string[],
  slots: readonly number[] | undefined,
) {
  return lines ? (
    <>
      <span className="database-slot">{inner}</span>
      <ChangeLines lines={lines} shows={value => shown.includes(value)} slots={slots?.slice(1) ?? []} wrap={wrap} />
    </>
  ) : (
    inner
  )
}

/** A row with change lines lays its slots out at the heights the layout gave them. */
const grid = (slots: readonly number[] | undefined, lines: readonly ChangeLine[] | undefined): CSSProperties =>
  // The row's own slot takes what its top border leaves; each change line its own height.
  lines && slots ? {gridTemplateRows: ['minmax(0, 1fr)', ...slots.slice(1).map(slot => `${slot}px`)].join(' ')} : {}

/** An enum's value: a row of its card, added or removed with the enum's own change. */
function ValueRow({card, row}: {card: Card; row: FrameColumn}) {
  const {props, diff, rowBadges, change, wrap, text} = card
  const {change: column, entity: version, top, height, opacity} = row
  const fits = oneLine(row.slots?.[0] ?? height)
  const valueEmphasis = diff ? props.emphasis(column) : rowBadges ? props.emphasis(column, change.id) : 0
  const marked = mark(card, column, undefined, valueEmphasis)
  return (
    <div
      onClick={select(props, change.id)}
      className={`database-column database-row database-value${marked.className}`}
      style={{top, height, opacity, ...marked.style}}
      {...marked.attributes}
    >
      <span className="database-key" />
      <span className="database-rowtext">
        <code className={`database-value-name${text}`} {...identifier}>
          <Breakable lines={wrap('value', version.label, fits)} />
        </code>
      </span>
      <GlyphStatus change={column} emphasis={valueEmphasis} />
    </div>
  )
}

/** A key or index of the table: its kind marker, the columns it covers and its own name, whole. */
function KeyRow({card, row, keyRow}: {card: Card; row: FrameColumn; keyRow: NonNullable<FrameColumn['key']>}) {
  const {props, rowBadges, firstKey, wrap, text} = card
  const {change: column, top, height, opacity, lines, slots} = row
  const fits = oneLine(slots?.[0] ?? height)
  const emphasis = props.emphasis(column)
  const selected = props.selectedId === column.id
  const marked = mark(card, column, lines, emphasis)
  const title = keyRow.name ? `${keyRow.text} (${keyRow.name})` : keyRow.text
  const classes = `database-column database-row database-keyrow pk-part${top === firstKey ? ' first' : ''}${selected ? ' selected' : ''}`
  return (
    <div
      data-entity-id={column.id}
      onClick={select(props, column.id)}
      className={`${classes}${marked.className}`}
      style={{top, height, opacity, ...marked.style, ...grid(slots, lines)}}
      {...marked.attributes}
    >
      {content(
        card,
        <>
          <span className="database-key" title={keyRow.title}>
            <span aria-hidden="true">{keyRow.marker}</span>
            <span className="sr-only">{keyRow.title}</span>
          </span>
          {/* Data whole, never truncated: the columns and the name wrap, and the row is laid out tall enough for them. */}
          <span className="database-rowtext">
            <button type="button" className={`entity-link${text}`} aria-pressed={selected} title={title} {...identifier}>
              <Breakable lines={wrap('key', keyRow.text, fits)} />
            </button>
            {keyRow.name && (
              <code className={text.trim() || undefined} {...identifier}>
                <Breakable lines={wrap('key', keyRow.name, fits)} />
              </code>
            )}
          </span>
          <GlyphStatus change={column} emphasis={rowBadges ? emphasis : 0} />
          {!rowBadges && emphasis > 0.05 && isChanged(column) && <span className="sr-only">{describeChange(column)}</span>}
        </>,
        lines,
        [keyRow.text, ...(keyRow.name ? [keyRow.name] : [])],
        slots,
      )}
    </div>
  )
}

/** A column's key marker: the single-column key or foreign-key constraint it stands for, selectable, with its own status. */
function Marker({card, marker, tint, emphasis}: {card: Card; marker: FrameColumn['marker']; tint: number; emphasis: number}) {
  const {props} = card
  const markerChange = marker?.change
  return (
    <span
      className={`database-key${marker?.key ? ' database-marker' : ''}${marker?.key && props.selectedId === marker.key ? ' selected' : ''}`}
      title={marker?.title}
      {...(marker?.key ? {'data-entity-id': marker.key, onClick: select(props, marker.key)} : {})}
      data-change={tint > 0.01 ? classifyChange(markerChange!) : undefined}
      style={{'--emphasis': tint} as CSSProperties}
    >
      {marker && (
        <>
          <span aria-hidden="true">{marker.label}</span>
          <span className="sr-only">
            {marker.title}
            {emphasis > 0.05 ? `, ${describeChange(markerChange!)}` : ''}
          </span>
        </>
      )}
    </span>
  )
}

/**
 * The columns the Changes scope leaves out of a shown table, folded into one row: a button that opens them in place (the
 * table grows to hold them, and the schema lays out again around it). Once open, the row stays below them as "Hide 7
 * unchanged columns", which folds them again.
 */
function FoldRow({card, row}: {card: Card; row: FrameColumn}) {
  const {change: fold, entity: version, top, height, opacity} = row
  const label = version.label
  const open = version.data?.open === true
  return (
    <div
      className="database-row database-fold"
      style={{top, height, opacity}}
      data-fold={open ? 'open' : 'closed'}
      {...placeAttributes(card.places.get(fold.id))}
    >
      <button
        type="button"
        className="database-fold-button"
        aria-expanded={open}
        onClick={event => {
          event.stopPropagation()
          // After the click is handled: the new layout replaces this button, and the shell would read a click on a
          // detached element as one on the table.
          setTimeout(() => (open ? card.props.scope?.collapse([fold.id]) : card.props.scope?.expand([fold.id])))
        }}
        title={open ? label : `Show ${label[0]!.toLowerCase()}${label.slice(1)}`}
      >
        <svg className="database-fold-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d={open ? 'M5 3l3 3 3-3M5 13l3-3 3 3' : 'M5 6l3-3 3 3M5 10l3 3 3-3'}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{label}</span>
      </button>
    </div>
  )
}

/** A column: its key marker, then its name and type whole, on one line when the card has room. */
function ColumnRow({card, row}: {card: Card; row: FrameColumn}) {
  const {props, rowBadges, wrap, text} = card
  const {change: column, entity: version, top, height, opacity, marker, lines, slots} = row
  const fits = oneLine(slots?.[0] ?? height)
  const emphasis = props.emphasis(column)
  const columnEmphasis = rowBadges ? emphasis : 0
  const selected = props.selectedId === column.id
  const marked = mark(card, column, lines, emphasis)
  const type = columnType(version)
  // A column's key marker is the single-column key or foreign-key constraint it stands for: selectable, with its own status.
  const markerChange = marker?.change
  const markerChanged = markerChange !== undefined && isChanged(markerChange)
  const markerEmphasis = markerChanged ? props.emphasis(markerChange) : 0
  const markerTint = rowBadges ? markerEmphasis : 0
  const glyph =
    !isChanged(column) && markerChanged && markerTint > 0.01
      ? {change: markerChange, emphasis: markerTint}
      : {change: column, emphasis: columnEmphasis}
  return (
    <div
      data-entity-id={column.id}
      onClick={() => props.onSelect(column.id)}
      className={`database-column database-row pk-part${selected ? ' selected' : ''}${marked.className}`}
      style={{top, height, opacity, ...marked.style, ...grid(slots, lines)}}
      {...marked.attributes}
    >
      {content(
        card,
        <>
          <Marker card={card} marker={marker} tint={markerTint} emphasis={markerEmphasis} />
          {/* Name and type whole: on one line when the card has room, else each wraps and the type goes under the name. */}
          <span className="database-rowtext">
            <button type="button" className={`entity-link${text}`} aria-pressed={selected} {...identifier}>
              <Breakable lines={wrap('column', version.label, fits)} />
            </button>
            <code
              className={text.trim() || undefined}
              title={declaredType(version) ? `${type} (${declaredType(version)})` : undefined}
              {...identifier}
            >
              <Breakable lines={wrap('type', type, fits)} />
            </code>
          </span>
          <GlyphStatus change={glyph.change} emphasis={glyph.emphasis} />
          {/* A row of a wholly added or removed table shows its table's status; assistive technology still hears its own. */}
          {!rowBadges && emphasis > 0.05 && isChanged(column) && <span className="sr-only">{describeColumn(column)}</span>}
        </>,
        lines,
        [version.label, baseType(version)],
        slots,
      )}
    </div>
  )
}

/** A card's header: its name whole (wrapping where the frame is too narrow), its kind and its status. */
function CardHeader({card, entity, header, status}: {card: Card; entity: Entity; header: number; status: number}) {
  const {props, diff, wrap, change, text} = card
  const headerFits = header <= textMetrics.header + 0.5
  const view = entity.kind === 'view'
  const enumCard = entity.kind === 'enum'
  const renamed = diff && change.before && change.after && change.before.label !== change.after.label ? change.before.label : undefined
  return (
    <header
      className={`database-row${headerFits ? '' : ' wrapped'}`}
      style={{height: header, '--database-status-width': `${status}px`} as CSSProperties}
      onClick={() => props.onSelect(change.id)}
    >
      <button
        type="button"
        className={`entity-link${text}`}
        aria-pressed={props.selectedId === change.id}
        {...(renamed ? {title: `${entity.label} (was ${renamed})`} : {})}
        {...identifier}
      >
        {renamed ? (
          <ValueChange
            layout={headerFits ? 'inline' : 'stacked'}
            before={<Breakable lines={wrap('type', renamed, headerFits, 'header-pill')} />}
            after={<Breakable lines={wrap('type', entity.label, headerFits, 'header-pill')} />}
            className="database-change-values"
          />
        ) : (
          <Breakable lines={wrap('name', entity.label, headerFits)} />
        )}
      </button>
      {(view || enumCard) && <span className="database-kind">{view ? 'view' : 'enum'}</span>}
      <ChangeStatus change={change} emphasis={props.emphasis(change)} className={`database-status${status ? '' : ' empty'}`} />
    </header>
  )
}

export function Table({table, props, diff, wrap}: {table: SchemaFrame['tables'][number]; props: RendererProps; diff: boolean; wrap: Wrap}) {
  const {change, entity, box, header, status, opacity, columns} = table
  // Rows of a wholly added or removed table share its status rather than repeating it; the diff marks every row.
  const survives = change.before !== undefined && change.after !== undefined
  const card: Card = {
    props,
    diff,
    wrap,
    change,
    survives,
    rowBadges: survives || diff,
    firstKey: Math.min(...columns.filter(row => row.kind === 'key').map(row => row.top)),
    text: diff ? ' pk-diff-text' : '',
    places: rowPlaces(columns),
  }
  const view = entity.kind === 'view'
  const enumCard = entity.kind === 'enum'
  const classes = `database-table${view ? ' database-view-card' : ''}${enumCard ? ' database-enum-card' : ''}`
  return (
    <section
      className={`${classes}${props.selectedId === change.id ? ' selected' : ''}`}
      aria-label={`${view ? 'View' : enumCard ? 'Enum' : 'Table'} ${entity.label}`}
      data-entity-id={change.id}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        opacity,
        ...(diff ? {'--emphasis': props.emphasis(change)} : {}),
      }}
      {...(diff ? changeMark(change) : {})}
    >
      {/* The name is data, shown whole: the card is sized for it, and where the frame is too narrow it wraps, with the kind and status under it. */}
      <CardHeader card={card} entity={entity} header={header} status={status} />
      {columns.map(row =>
        isFold(row.change.id) ? (
          <FoldRow key={row.change.id} card={card} row={row} />
        ) : row.kind === 'value' ? (
          <ValueRow key={row.change.id} card={card} row={row} />
        ) : row.kind === 'key' && row.key ? (
          <KeyRow key={row.change.id} card={card} row={row} keyRow={row.key} />
        ) : (
          <ColumnRow key={row.change.id} card={card} row={row} />
        ),
      )}
      {!columns.length && (
        <p className="database-empty" style={{top: header}}>
          {enumCard ? 'No values at this point.' : 'No columns at this point.'}
        </p>
      )}
    </section>
  )
}
