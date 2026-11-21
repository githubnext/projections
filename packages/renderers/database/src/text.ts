/**
 * Data is shown whole. Every name, type, key and value in the schema is
 * measured in the font it is drawn with, cards are sized to fit their text on
 * one line where the frame has room, and where it doesn't, text wraps at its
 * natural break points (after `_`, `.`, `/`, `-`, `,` or a space, and at case
 * and digit boundaries, before arbitrary characters) and its row or header
 * grows. The layout and the view share these break points: the layout counts
 * lines with `wrapText`, and the view renders `segments` joined by `<wbr>`, so
 * the browser breaks the same lines.
 */

/**
 * What a text is: a card's name, its kind label (`enum`, `view`), a column's name or type, a key's text or name, an
 * enum value, or a status word (`Modified`).
 */
export type TextRole = 'name' | 'kind' | 'column' | 'type' | 'key' | 'value' | 'status'

/** Width of `text` in CSS pixels, in the font its role is drawn with. */
export type MeasureText = (role: TextRole, text: string) => number

/** Card and row widths that aren't text, in CSS pixels (styles.css). */
export interface TextChrome {
  headerPad: number
  headerGap: number
  /** A status part's icon and the gap after it, and the gap between parts. */
  statusIcon: number
  statusGap: number
  rowPadLeft: number
  rowPadRight: number
  rowGap: number
  /** The key marker cell (`PK`, `FK`, `IX`…). */
  marker: number
  /** The row's status glyph cell. */
  glyph: number
  /** A value pill's padding and border, across; the gap around a value change's arrow, and the arrow (diff mode). */
  pillPad: number
  valueGap: number
}

export const defaultChrome: TextChrome = {
  headerPad: 12,
  headerGap: 12,
  statusIcon: 15.6,
  statusGap: 8,
  rowPadLeft: 8,
  rowPadRight: 12,
  rowGap: 8,
  marker: 21,
  glyph: 16,
  pillPad: 16,
  valueGap: 4,
}

/** Line heights and paddings that size rows and headers (styles.css). */
export const textMetrics = {
  /** A row's text line and its vertical padding: one line is a 32px row, each further line adds one more. */
  line: 16,
  rowPad: 8,
  /** A one-line header, and a wrapped header's name line and padding (the kind and status get a line of their own). */
  header: 38,
  headerLine: 18,
  headerPad: 8,
  /** Room a fitted line keeps spare, so a rounding difference between measuring and painting never wraps it. */
  slack: 2,
} as const

/** An estimate for when no fonts can be measured (tests, server rendering): monospace data, sans labels. */
export const estimateText: MeasureText = (role, text) => {
  const size = role === 'name' || role === 'column' ? 14 : 12
  return text.length * size * (role === 'kind' || role === 'status' ? 0.6 : 0.62)
}

const separator = /[_./\-,: ]/

/** Splits `text` before each index where `boundary(previous, current)` holds. */
function split(text: string, boundary: (previous: string, current: string) => boolean): string[] {
  const pieces: string[] = []
  let start = 0
  for (let index = 1; index < text.length; index++) {
    if (boundary(text[index - 1]!, text[index]!)) {
      pieces.push(text.slice(start, index))
      start = index
    }
  }
  pieces.push(text.slice(start))
  return pieces.filter(piece => piece.length > 0)
}

/**
 * `text` split where a line breaks first: after `_ . / - , :` or a space, and
 * before `(`. Joined, the pieces are `text`.
 */
export function segments(text: string): string[] {
  return split(text, (previous, current) => (separator.test(previous) && !separator.test(current)) || (current === '(' && previous !== ' '))
}

/** A piece split where a line breaks next, when the piece alone is too long: case changes (`Order|Status`) and letter–digit changes. */
export function subsegments(piece: string): string[] {
  return split(
    piece,
    (previous, current) =>
      (/[a-z0-9]/.test(previous) && /[A-Z]/.test(current)) ||
      (/[A-Za-z]/.test(previous) && /[0-9]/.test(current)) ||
      (/[0-9]/.test(previous) && /[A-Za-z]/.test(current)),
  )
}

/**
 * Greedy lines of `text` within `room`: pieces (`segments`) fill a line while
 * they fit; a piece wider than a line breaks at its case and digit changes
 * (`subsegments`), and a part still wider between characters.
 */
export function wrapText(text: string, room: number, width: (text: string) => number): string[] {
  if (!text) return ['']
  const lines: string[] = []
  let line = ''
  const push = (piece: string) => {
    if (!line || width(line + piece) <= room) {
      line += piece
      return
    }
    lines.push(line)
    line = piece
  }
  for (const piece of segments(text)) {
    if (width(piece) <= room) {
      push(piece)
      continue
    }
    for (const part of subsegments(piece)) {
      if (width(part) <= room) {
        push(part)
        continue
      }
      for (const character of part) {
        if (line && width(line + character) > room) {
          lines.push(line)
          line = ''
        }
        line += character
      }
    }
  }
  if (line) lines.push(line)
  return lines
}

/** What a card row draws, in each version it has. */
export type RowText =
  | {kind: 'column'; name: string; type: string}
  | {kind: 'key'; text: string; name?: string | undefined}
  | {kind: 'value'; text: string}
  /** Diff mode: a change line under a row, its word (`Type changed`) and the old and new values it shows as pills. */
  | {kind: 'change'; word: string; before?: string | undefined; after?: string | undefined}

/** A card's name and kind label (`enum`, `view`), in each version it has, and the status words it can show (`Modified`). */
export interface CardText {
  label: string
  kind?: string | undefined
  status?: readonly string[] | undefined
  /** Diff mode: a renamed card's old name; the header shows old → new as value pills. */
  rename?: string | undefined
}

/** Where a text is wrapped: a header's name, a row's part, a value pill in a change line, or a pill in a header. */
export type TextArea = 'header' | 'row' | 'pill' | 'header-pill'

export interface TextSizer {
  /** The narrowest card that shows this card's header and every row's text on one line. */
  cardNeed(card: string, rows: readonly string[]): number
  /** The header's height on a card `width` wide: one line when it fits, else its name wraps and the kind and status go under it. */
  header(card: string, width: number): number
  /** The row's height on a card `width` wide, tall enough for its widest version. */
  row(id: string, width: number): number
  /** The header's status cell: room for the status words this card shows, none for a card the comparison doesn't change. */
  status(card: string): number
  /**
   * The lines a card `width` wide draws `text` in: one when its header or row fits on one line, else as wrapped in
   * its area (a header's name, a row's part, a value pill), exactly as the heights above count them.
   */
  lines(role: TextRole, text: string, width: number, fits: boolean, area?: TextArea): string[]
}

/**
 * Sizes cards, headers and rows from what they show (`cards`, `rows`: every
 * version of each), measured with `measure`. Results are cached per width.
 */
export function createTextSizer(
  cards: (id: string) => readonly CardText[],
  rows: (id: string) => readonly RowText[],
  measure: MeasureText = estimateText,
  chrome: TextChrome = defaultChrome,
): TextSizer {
  const {line, rowPad, header, headerLine, headerPad, slack} = textMetrics
  const widths = new Map<string, number>()
  const width = (role: TextRole, text: string) => {
    const key = `${role}\u0000${text}`
    let value = widths.get(key)
    if (value === undefined) widths.set(key, (value = measure(role, text)))
    return value
  }
  const wrapped = (role: TextRole, text: string, room: number) => wrapText(text, room, piece => width(role, piece) + slack)
  const lines = (role: TextRole, text: string, room: number) => wrapped(role, text, room).length
  const rowChrome = chrome.rowPadLeft + chrome.marker + chrome.rowGap + chrome.rowGap + chrome.glyph + chrome.rowPadRight
  /** One line's width for a row's text (the columns and the name of a key, a column's name and type). */
  const rowText = (row: RowText): number =>
    row.kind === 'column'
      ? width('column', row.name) + chrome.rowGap + width('type', row.type)
      : row.kind === 'key'
        ? width('key', row.text) + (row.name ? chrome.rowGap + width('key', row.name) : 0)
        : row.kind === 'change'
          ? width('kind', row.word) +
            (row.before !== undefined || row.after !== undefined ? chrome.rowGap : 0) +
            (row.before !== undefined ? pill(row.before) : 0) +
            (row.before !== undefined && row.after !== undefined ? arrow() : 0) +
            (row.after !== undefined ? pill(row.after) : 0) -
            // A change line has no key marker or glyph cell.
            (chrome.marker + 2 * chrome.rowGap + chrome.glyph)
          : width('value', row.text)
  const statusOf = (text: CardText) =>
    (text.status ?? []).reduce((sum, word, index) => sum + (index ? chrome.statusGap : 0) + chrome.statusIcon + width('status', word), 0)
  const status = (card: string) =>
    Math.ceil(Math.max(0, ...cards(card).map(statusOf)) + (cards(card).some(text => text.status?.length) ? textMetrics.slack : 0))
  const pill = (text: string) => width('type', text) + chrome.pillPad
  const arrow = () => width('kind', '→') + 2 * chrome.valueGap
  const headerText = (card: CardText, cell: number) =>
    (card.rename ? pill(card.rename) + arrow() + pill(card.label) : width('name', card.label)) +
    (card.kind ? chrome.headerGap + width('kind', card.kind) : 0) +
    (cell ? chrome.headerGap + cell : 0)
  const rooms = (cardWidth: number): Record<TextArea, number> => ({
    header: cardWidth - 2 * chrome.headerPad,
    'header-pill': cardWidth - 2 * chrome.headerPad - chrome.pillPad,
    row: cardWidth - rowChrome,
    pill: cardWidth - chrome.rowPadLeft - chrome.rowPadRight - chrome.pillPad,
  })
  const cache = new Map<string, number>()
  const cached = (key: string, compute: () => number) => {
    let value = cache.get(key)
    if (value === undefined) cache.set(key, (value = compute()))
    return value
  }
  return {
    cardNeed: (card, ids) =>
      Math.ceil(
        Math.max(
          ...cards(card).map(text => 2 * chrome.headerPad + headerText(text, status(card))),
          ...ids.flatMap(id => rows(id).map(row => rowChrome + rowText(row))),
        ) + slack,
      ),
    header: (card, cardWidth) =>
      cached(`h\u0000${card}\u0000${cardWidth}`, () => {
        const versions = cards(card)
        if (versions.every(text => 2 * chrome.headerPad + headerText(text, status(card)) + slack <= cardWidth)) return header
        const room = rooms(cardWidth)
        return Math.max(
          ...versions.map(text =>
            text.rename
              ? // Old and new names as stacked pills, then the kind and status.
                2 * headerPad +
                headerLine +
                [text.rename, text.label].reduce((sum, name) => sum + line * lines('type', name, room['header-pill']) + 4, 0)
              : 2 * headerPad + headerLine * (lines('name', text.label, room.header) + 1),
          ),
        )
      }),
    row: (id, cardWidth) =>
      cached(`r\u0000${id}\u0000${cardWidth}`, () => {
        const room = rooms(cardWidth)
        return Math.max(
          line + 2 * rowPad,
          ...rows(id).map(row => {
            if (rowText(row) + slack <= room.row) return line + 2 * rowPad
            if (row.kind === 'change')
            // The word, then each value pill under it: its lines, its border and a gap.
            {
              return (
                2 * rowPad +
                line +
                [row.before, row.after].reduce(
                  (sum, value) => (value === undefined ? sum : sum + line * lines('type', value, room.pill) + 4),
                  0,
                )
              )
            }
            const count =
              row.kind === 'column'
                ? lines('column', row.name, room.row) + lines('type', row.type, room.row)
                : row.kind === 'key'
                  ? lines('key', row.text, room.row) + (row.name ? lines('key', row.name, room.row) : 0)
                  : lines('value', row.text, room.row)
            return line * count + 2 * rowPad
          }),
        )
      }),
    status,
    lines: (role, text, cardWidth, fits, area = role === 'name' ? 'header' : 'row') =>
      fits ? [text] : wrapped(role, text, rooms(cardWidth)[area]),
  }
}
