// A graph card's text in diff mode, laid out whole (see `DiffCardText`).

import {cardTextMetrics, cardWidthRange} from '../card-text.js'
import {cardIconRoom} from '../card-icons.js'
import {svgStatusWidth} from '../svg-status.js'
import {cardFooterHeight, cardHeight} from '../layout.js'
import {wrapText} from '../wrap.js'
import {nextLine, writeDetail, writeFields, writeKindLine} from './lines.js'
import type {CardLines, KindLine} from './lines.js'
import {diffCardMetrics} from './metrics.js'
import type {DiffCardInput, DiffCardText} from './metrics.js'

type Label = {text: string; tone?: 'was' | 'now'}

/** The kind line of a card that isn't a file's: the kind, its note and its detail per revision. */
function kindLine(input: DiffCardInput): KindLine {
  const entity = (input.after ?? input.before)!
  const note = [input.kind?.note, entity.confidence === 'inferred' ? 'Inferred' : undefined].filter(Boolean).join(' · ')
  const details = [input.before, input.after].map(side => (side ? input.detail?.(side) : undefined))
  const changed = details[0] !== undefined && details[1] !== undefined && details[0] !== details[1]
  return {
    kind: input.kind?.text ?? entity.kind,
    identifier: input.kind?.identifier ?? false,
    note,
    noteText: note ? ` · ${note}` : '',
    detail: changed ? `${details[0]} → ${details[1]}` : (details[1] ?? details[0]),
    details,
    changed,
    indent: input.icon ? cardIconRoom : 0,
  }
}

/**
 * The width a card's text needs on one line, its inset included: the kind line (with its note and detail), the
 * labels, the field changes and the status, whichever is widest.
 */
function naturalWidth(input: DiffCardInput, kind: KindLine | undefined, labels: readonly Label[], left: number): number {
  const m = diffCardMetrics
  const scale = input.textScale ?? 1
  const mono = m.charWidth * scale,
    prose = m.proseCharWidth * scale
  const kindRow = kind
    ? kind.indent +
      kind.kind.length * (kind.identifier ? mono : prose) +
      kind.noteText.length * prose +
      (kind.detail !== undefined ? 8 + kind.detail.length * mono : 0) +
      (input.reserve ?? 0)
    : 0
  const labelRow = Math.max(...labels.map(label => label.text.length * (input.prose ? cardTextMetrics.labelAdvance * scale : mono)))
  const fieldRow = Math.max(
    0,
    ...(input.fields ?? [])
      .slice(0, m.fieldLineLimit)
      .flatMap(field => [
        field.key.length * (field.prose || field.summary ? prose : mono),
        (field.before.length + field.after.length + 3) * mono,
      ]),
  )
  return (
    Math.max(left + Math.max(kindRow, labelRow, fieldRow), m.textLeft + svgStatusWidth(input.status ?? [], undefined, scale)) + m.textInset
  )
}

/** Lays out a diff card's text (see `DiffCardText`). Deterministic: the same entities always give the same lines. */
export function diffCardText(input: DiffCardInput): DiffCardText {
  const m = diffCardMetrics
  const scale = input.textScale ?? 1
  const entity = (input.after ?? input.before)!
  const file = entity.kind === 'file'
  const left = file ? m.fileTextLeft : m.textLeft
  const kind = file ? undefined : kindLine(input)
  const labels: Label[] =
    input.before && input.after && input.before.label !== input.after.label
      ? [
          {text: input.before.label, tone: 'was'},
          {text: input.after.label, tone: 'now'},
        ]
      : [{text: entity.label}]
  // As wide as its longest line needs unwrapped, within the card range (and its expander's room past it); its text
  // then wraps to that width.
  const natural = naturalWidth(input, kind, labels, left)
  // An icon and an expander take room of their own: the widest card is that much wider, so its text keeps the room
  // it had.
  const widest = cardWidthRange.max + Math.ceil(kind?.indent ?? 0) + (input.reserve ?? 0)
  const cardWidth = input.width ?? Math.min(widest, Math.max(cardWidthRange.min, Math.ceil(natural / 4) * 4))
  const width = cardWidth - m.textInset - left
  const mono = m.charWidth * scale
  const card: CardLines = {
    lines: [],
    y: m.firstBaseline - m.line,
    left,
    width,
    room: Math.floor(width / mono),
    reserve: input.reserve ?? 0,
    cardWidth,
    mono,
    prose: m.proseCharWidth * scale,
  }
  if (kind) writeKindLine(card, kind)
  labels.forEach((label, index) => {
    wrapText(label.text, card.room).forEach((part, line) => {
      card.lines.push({
        x: left,
        y: nextLine(card, !file && index === 0 && line === 0 ? m.labelGap : 0),
        className: `node-label${file ? ' file-path' : ''}`,
        identifier: !input.prose,
        spans: [{text: part, ...(label.tone ? {tone: label.tone} : {})}],
      })
    })
  })
  // A file has no kind line: its detail (a size, a version) takes a line of its own under its path.
  const fileDetail = file ? kindLine(input) : undefined
  if (fileDetail?.detail !== undefined) writeDetail(card, fileDetail, false)
  writeFields(card, input.fields ?? [])
  return {lines: card.lines, width: cardWidth, height: Math.max(cardHeight(entity.kind), card.y + m.bottom + cardFooterHeight)}
}
