import type {Entity} from '@githubnext/projections-schemas'
import {identifier, type EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {describeChange, statusParts} from '@githubnext/projections-renderer-kit'
import {Icon, ValueChange} from '@githubnext/projections-renderer-kit/react'
import {Breakable} from './measure.js'
import {textMetrics} from './text.js'
import type {ChangeLine} from './change-lines.js'
import {typeChange} from './types.js'
import type {DatabaseTransition} from './transition.js'

/** How a card draws its text in lines (the layout's `lines`). */
export type Wrap = DatabaseTransition['lines']
/** Whether a slot of `height` holds one line: then its text is drawn whole on it. */
export const oneLine = (height: number) => height <= 2 * textMetrics.rowPad + textMetrics.line + 0.5

/**
 * A column row's status as its icon alone, tinted and faded with emphasis, in
 * a fixed two-character cell reserved on every row so names and types keep
 * nearly all their room. A renamed and changed column shows the change's icon
 * (its new name already shows the rename). The word stays in the DOM for
 * assistive technology, and as the cell's tooltip; table headers show it.
 */
export function GlyphStatus({change, emphasis}: {change: EntityChange<Entity>; emphasis: number}) {
  const parts = emphasis > 0.01 ? statusParts(change) : []
  const word = parts.length ? describeColumn(change) : undefined
  return (
    <span className="database-glyph" data-change-footer="" title={word}>
      {word && (
        <span className="pk-status-text" style={{opacity: Math.min(1, emphasis)}} aria-hidden={emphasis < 0.05}>
          {parts.slice(-1).map(part => (
            <span key={part.status} className={`pk-status-part ${part.status}`} data-change-status={part.status} aria-hidden="true">
              <Icon name={part.icon} />
            </span>
          ))}
          <span className="sr-only">{word}</span>
        </span>
      )}
    </span>
  )
}

/** A column's change in words, with its type change: `Modified, type varchar(120) to varchar(200)`. */
export function describeColumn(change: EntityChange<Entity>): string {
  const retyped = typeChange(change)
  return retyped ? `${describeChange(change)}, ${retyped}` : describeChange(change)
}

/**
 * A row's change lines in the diff, each in its own row slot under the row:
 * what changed in words (`Type changed`, `Made required`), then the old value
 * struck through, right under the new one the row shows. A new value the row
 * doesn't show follows the old one.
 */
export function ChangeLines({
  lines,
  shows,
  slots,
  wrap,
}: {
  lines: readonly ChangeLine[]
  shows: (value: string) => boolean
  /** Each line's slot height: a taller slot wraps, the word first and each value whole under it. */
  slots: readonly number[]
  wrap: Wrap
}) {
  return lines.map((line, index) => {
    const shown = line.after !== undefined && shows(line.after)
    const fits = oneLine(slots[index] ?? 0)
    const value = (text: string | undefined) =>
      text === undefined ? undefined : (
        <span {...identifier}>
          <Breakable lines={wrap('type', text, fits, 'pill')} />
        </span>
      )
    return (
      <span key={line.key} className={`database-slot database-change-line${fits ? '' : ' wrapped'}`}>
        <span className="database-change-word">{line.word}</span>
        {(line.before !== undefined || line.after !== undefined) && (
          <ValueChange
            layout={fits ? 'inline' : 'stacked'}
            before={value(line.before)}
            after={shown ? undefined : value(line.after)}
            className="database-change-values"
          />
        )}
        {shown && <span className="sr-only">, now {line.after}</span>}
      </span>
    )
  })
}
