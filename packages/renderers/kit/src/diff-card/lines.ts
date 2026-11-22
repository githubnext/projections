import type {FieldLine} from '../diff/lines.js'
import {wrapText} from '../wrap.js'
import {diffCardMetrics} from './metrics.js'
import type {DiffCardLine, DiffCardSpan} from './metrics.js'

/** A diff card's text as it is laid out, line by line: each line's baseline follows the one before. */
export interface CardLines {
  lines: DiffCardLine[]
  /** The last line's baseline. */
  y: number
  /** Where text starts, and the width it may take before the card's inset. */
  left: number
  width: number
  /** How many monospace characters fit in `width`. */
  room: number
  /** Room kept free at the right of the kind line's first line (see `DiffCardInput.reserve`). */
  reserve: number
  cardWidth: number
  /** Character advances at the card's type size: monospace and human text. */
  mono: number
  prose: number
}

/** Starts a line `gap` below the usual line spacing and returns its baseline. */
export function nextLine(card: CardLines, gap = 0): number {
  return (card.y += diffCardMetrics.line + gap)
}

/** A change on one line: the old value struck, an arrow, then the new value. */
const inlineChange = (before: string, after: string): DiffCardSpan[] => [
  {text: before, tone: 'was'},
  {text: ' → ', tone: 'arrow'},
  {text: after, tone: 'now'},
]

/** A change too long for one line: the old value's lines, then the new value's after an arrow. */
function changeLines(before: string, after: string, room: number): DiffCardSpan[][] {
  return [
    ...wrapText(before, room).map(part => [{text: part, tone: 'was' as const}]),
    ...wrapText(`→ ${after}`, room).map((part, index): DiffCardSpan[] =>
      index === 0
        ? [
            {text: '→ ', tone: 'arrow'},
            {text: part.slice(2), tone: 'now'},
          ]
        : [{text: part, tone: 'now'}],
    ),
  ]
}

/** A card's kind line: the kind, a note and a short detail per revision, all optional but the kind. */
export interface KindLine {
  kind: string
  identifier: boolean
  /** The note, and the note as it follows the kind (` · note`), or empty. */
  note: string
  noteText: string
  /** The detail as shown (`was → now` when it changed), and per revision. */
  detail: string | undefined
  details: (string | undefined)[]
  changed: boolean
  /** Room before the kind's text for the card's icon (see `GraphCanvasProps.icon`); 0 without one. */
  indent: number
}

/** Lays out a card's kind line: a note and an unchanged detail stay on the kind's last line when they fit there. */
export function writeKindLine(card: CardLines, kind: KindLine): void {
  const width = card.width - kind.indent - card.reserve
  const left = card.left + kind.indent
  const kindLines = wrapText(kind.kind, Math.max(1, Math.floor(width / (kind.identifier ? card.mono : card.prose))))
  const last = kindLines.at(-1)!
  const kindWidth = (text: string) => text.length * (kind.identifier ? card.mono : card.prose)
  // The kind line's last line, its note and a gap, then `extra` monospace characters at the right.
  const besideFits = (extra: number) => kindWidth(last) + kind.noteText.length * card.prose + (extra ? 8 + extra * card.mono : 0) <= width
  const detailBeside = kind.detail !== undefined && besideFits(kind.detail.length)
  const noteBeside = detailBeside || besideFits(0)
  kindLines.forEach((part, index) => {
    const final = index === kindLines.length - 1
    const spans: DiffCardSpan[] = [{text: part}]
    if (final && kind.noteText && noteBeside) spans.push({text: kind.noteText, tone: 'note'})
    card.lines.push({x: left, y: nextLine(card), className: 'node-kind', identifier: kind.identifier, spans})
  })
  if (kind.noteText && !noteBeside) {
    card.lines.push({x: left, y: nextLine(card), className: 'node-kind', identifier: false, spans: [{text: kind.note, tone: 'note'}]})
  }
  if (kind.detail !== undefined) writeDetail(card, kind, detailBeside)
}

/** Writes a kind line's detail: beside the kind's last line, or on lines of its own under what is written so far. */
export function writeDetail(card: CardLines, kind: KindLine, beside: boolean): void {
  const detailLine = (spans: DiffCardSpan[], atEnd: boolean) =>
    card.lines.push({
      x: atEnd ? card.cardWidth - diffCardMetrics.textInset - card.reserve : card.left,
      y: atEnd ? card.y : nextLine(card),
      ...(beside ? {anchor: 'end' as const} : {}),
      className: 'node-detail',
      identifier: true,
      spans,
    })
  const [before, after] = kind.details
  if (beside) detailLine(kind.changed ? inlineChange(before!, after!) : [{text: kind.detail!}], true)
  else if (kind.changed) for (const spans of changeLines(before!, after!, card.room)) detailLine(spans, false)
  else for (const part of wrapText(kind.detail!, card.room)) detailLine([{text: part}], false)
}

/** Lays out a card's field changes, at most `fieldLineLimit`, then how many more there are. */
export function writeFields(card: CardLines, fields: readonly FieldLine[]): void {
  const m = diffCardMetrics
  fields.slice(0, m.fieldLineLimit).forEach((field, index) => {
    if (field.summary) {
      card.lines.push({
        x: card.left,
        y: nextLine(card, index === 0 ? m.fieldsGap : m.fieldGap),
        className: 'node-field-key',
        identifier: false,
        spans: [{text: field.key, tone: 'note'}],
      })
      return
    }
    wrapText(field.key, field.prose ? Math.floor(card.width / card.prose) : card.room).forEach((part, line) =>
      card.lines.push({
        x: card.left,
        y: nextLine(card, line === 0 ? (index === 0 ? m.fieldsGap : m.fieldGap) : 0),
        className: 'node-field-key',
        identifier: !field.prose,
        spans: [{text: part}],
      }),
    )
    writeFieldValue(card, field)
  })
  if (fields.length > m.fieldLineLimit) {
    const more = fields.length - m.fieldLineLimit
    card.lines.push({
      x: card.left,
      y: nextLine(card, m.fieldGap),
      className: 'node-field-key',
      identifier: false,
      spans: [{text: `and ${more} more ${more === 1 ? 'change' : 'changes'}`, tone: 'note'}],
    })
  }
}

/** A field's change on one line where it fits, wrapped otherwise, or a note when it is too long to show. */
function writeFieldValue(card: CardLines, field: FieldLine): void {
  const value = (spans: DiffCardSpan[]) =>
    card.lines.push({x: card.left, y: nextLine(card), className: 'node-field-value', identifier: true, spans})
  const huge = Math.max(field.before.length, field.after.length) > card.room * diffCardMetrics.valueLineLimit
  if (huge) {
    for (const part of wrapText('Changed; too long to show here, see details', Math.floor(card.width / card.prose))) {
      card.lines.push({
        x: card.left,
        y: nextLine(card),
        className: 'node-field-key',
        identifier: false,
        spans: [{text: part.trim(), tone: 'note'}],
      })
    }
  } else if (field.before.length + field.after.length + 3 <= card.room) value(inlineChange(field.before, field.after))
  else for (const spans of changeLines(field.before, field.after, card.room)) value(spans)
}
