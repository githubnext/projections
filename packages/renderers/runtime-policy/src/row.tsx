import type {ReactNode} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import {classifyChange, describeChange, isChanged, statusGlyphs, statusParts} from '@githubnext/projections-renderer-kit'
import {Icon} from '@githubnext/projections-renderer-kit/react'
import {interpretationIcons, interpretationText, type Item} from './model.js'
import {warnings} from './prose.js'
import {emphasisStyle, markOf, runAttributes, type Frame, type Run} from './frame.js'
import {Prose} from './breaks.js'

/**
 * Quiet column headers, for sighted readers; every row names its own parts. The status column's heading is laid out
 * whenever comparing and shows as its rows' statuses do (`status`, the strongest of them): a column whose rows inherit
 * their region's change, or don't change, is never headed, and at the endpoints nothing is.
 */
export function Head({frame, cells, status, as: Tag = 'li'}: {frame: Frame; cells: string[]; status: number; as?: 'div' | 'li'}) {
  const [main, ...rest] = cells
  const columns = cells.length === 3 ? ['effect', 'side'] : ['side']
  return (
    <Tag className="rp-row rp-head" aria-hidden="true">
      {frame.side === 'diff' && <span className="rp-cell rp-sign" />}
      <span className="rp-cell rp-main pk-label">{main}</span>
      {rest.map((cell, index) => (
        <span key={cell} className={`rp-cell rp-${columns[index]} pk-label`}>
          {cell}
        </span>
      ))}
      {frame.comparing && (
        <span className="rp-cell rp-status pk-label">
          <span style={status > 0.01 ? {opacity: Math.min(1, status)} : {opacity: 0, visibility: 'hidden'}}>Change</span>
        </span>
      )}
    </Tag>
  )
}

/** A sentence-case word lowered to continue a sentence (`New warning` → `new warning`). */
const continuing = (words: string) => words.charAt(0).toLowerCase() + words.slice(1)

/**
 * The status column: a stack of icon-led lines, the change first (`Added`), then one line per interpretation of the
 * comparator's (`New warning`, `Newly covered`), every line on one icon column, with no separators. Laid out on every
 * changed row and hidden until the change is emphasized, so it never moves anything. Assistive technology reads it as
 * one sentence (`Added, new warning, newly covered`). A row that inherits its region's change states it only for
 * assistive technology.
 */
export function Status({item, strength, inherited}: {item: Item; strength: number; inherited: boolean}) {
  const parts = statusParts(item.row)
  if (!parts.length) return <span className="rp-cell rp-status" />
  if (inherited) {
    return <span className="rp-cell rp-status">{strength > 0.01 && <span className="sr-only">{describeChange(item.row)}</span>}</span>
  }
  const words = item.interpretations.filter(name => interpretationText[name])
  const shown = strength > 0.01
  const sentence = [describeChange(item.row), ...words.map(name => continuing(interpretationText[name]!))].join(', ')
  return (
    <span className="rp-cell rp-status" data-change-footer="">
      <span
        className="rp-status-text"
        style={shown ? {opacity: Math.min(1, strength)} : {opacity: 0, visibility: 'hidden'}}
        aria-hidden="true"
      >
        {parts.map(part => (
          <span key={part.status} className={`pk-status-part ${part.status}`} data-change-status={part.status}>
            <Icon name={part.icon} className="rp-icon" />
            {part.label}
          </span>
        ))}
        {words.map(name => (
          <span key={name} className="rp-interpretation">
            {interpretationIcons[name] && <Icon name={interpretationIcons[name]} className="rp-icon" />}
            {interpretationText[name]}
          </span>
        ))}
      </span>
      {strength >= 0.05 && <span className="sr-only">{sentence}</span>}
    </span>
  )
}

/** The diff's sign column: the change glyph, and the change in words for assistive technology while no status shows. */
export function Sign({item, frame, strength}: {item: Item; frame: Frame; strength: number}) {
  if (frame.side !== 'diff') return null
  return (
    <span className="rp-cell rp-sign">
      <span aria-hidden="true">{statusGlyphs[classifyChange(item.row)]}</span>
      {strength <= 0 && isChanged(item.row) && <span className="sr-only">{describeChange(item.row)}</span>}
    </span>
  )
}

export function Warnings({entity}: {entity: Entity}) {
  const notes = warnings(entity)
  if (!notes.length) return null
  return (
    <span className="rp-cell rp-warnings">
      {notes.map(note => (
        <span key={note} className="rp-warning">
          <span className="rp-warning-label">
            <Icon name="warning" className="rp-icon" />
            <span className="pk-label">Warning</span>
          </span>
          <span className="pk-label">
            <Prose>{note}</Prose>
          </span>
        </span>
      ))}
    </span>
  )
}

/**
 * One row of a table, with a selection button that covers the row,
 * its sign, cells and status. Changed rows are filled and edged in their hue,
 * joined with marked neighbours into one run, unless they inherit their
 * region's change.
 */
export function Row({
  item,
  frame,
  className,
  inherited = false,
  regionFill = false,
  part = false,
  run,
  main,
  cells,
  as = 'li',
}: {
  item: Item
  frame: Frame
  className: string
  inherited?: boolean
  /** The region around the row is filled for its change, so the row isn't. */
  regionFill?: boolean
  /** A part of an enclosing item (a rule in a hook lane), rather than an item of its own. */
  part?: boolean
  /** Its place in a run of rows marked the same way; a run of its own by default. */
  run?: Run | undefined
  main: ReactNode
  cells?: ReactNode
  as?: 'div' | 'li'
}) {
  const strength = frame.strength(item)
  const selected = frame.props.selectedId === item.row.id
  const mark = regionFill ? undefined : markOf(item, frame, inherited)
  const Tag = as
  return (
    <Tag
      className={`rp-row${part ? ' pk-part' : ''} ${className}${mark ? ' pk-region pk-region-run' : ''}${selected ? ' selected' : ''}${frame.side === 'diff' && item.row.status === 'removed' ? ' departed' : ''}`}
      data-entity-id={item.row.id}
      data-change={mark}
      {...(mark ? runAttributes(run) : {})}
      style={emphasisStyle(strength)}
    >
      <Sign item={item} frame={frame} strength={strength} />
      <button type="button" className="rp-cell rp-main rp-select" aria-pressed={selected} onClick={() => frame.props.onSelect(item.row.id)}>
        {main}
      </button>
      {cells}
      <Warnings entity={item.entity} />
      {frame.comparing && <Status item={item} strength={strength} inherited={inherited} />}
    </Tag>
  )
}

/** A value that changed in the diff: the old one struck, then the new one. */
export function Changed({before, after}: {before: ReactNode; after: ReactNode}) {
  return (
    <>
      <del className="rp-old" data-change="removed">
        {before}
      </del>
      <span className="rp-arrow" aria-hidden="true">
        {' → '}
      </span>
      <span className="sr-only"> now </span>
      <ins className="rp-new" data-change="added">
        {after}
      </ins>
    </>
  )
}

/** A field as this frame reads it: old and new in the diff, otherwise the frame's revision. */
export function field(item: Item, frame: Frame, read: (entity: Entity) => string) {
  if (frame.side === 'diff' && item.before && item.after) {
    const before = read(item.before),
      after = read(item.after)
    if (before !== after) return <Changed before={<Prose>{before}</Prose>} after={<Prose>{after}</Prose>} />
  }
  return <Prose>{read(item.entity)}</Prose>
}

export const data = (entity: Entity, key: string) => {
  const value = entity.data?.[key]
  return typeof value === 'string' ? value : ''
}
