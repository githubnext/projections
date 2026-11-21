import type {Entity} from '@githubnext/projections-schemas'
import {sentenceCase} from '@githubnext/projections-renderer-sdk/presentation'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {svgStatusWidth} from './svg-status.js'
import {statusParts} from './emphasis.js'
import {cardIconRoom, hasIcon} from './card-icons.js'
import type {StatusPart} from './emphasis.js'

/** A card's kind line, the small text above its label (see `GraphCanvasProps.kindLine` and `entityKindLine`). */
export interface KindLineText {
  /** The text as drawn; a long one keeps its end, the most specific part (see `kindText`). */
  text: string
  /** Draw `text` in monospace, as code (a resource type, a qualified name); sans when unset. */
  identifier?: boolean
  /**
   * Text after the kind line in sans, after a ` · ` (`aws_db_instance · Replace`); `Inferred` follows it when the
   * entity is inferred.
   */
  note?: string
}

/**
 * An entity kind as a card shows it when the renderer gives no kind line of its own. A plain word or phrase
 * (`resource`, `data-source`, `message_queue`) is a category, so it reads as a label in sentence case ("Resource",
 * "Data source", and "npm package", whose name is lowercase; see `sentenceCase`); anything code-like (dots, slashes,
 * colons, inner capitals, digits) is data, shown verbatim in mono.
 */
export function entityKindLine(kind: string): KindLineText {
  if (!/^[a-z]+(?:[-_ ][a-z]+)*$/.test(kind)) return {text: kind, identifier: true}
  return {text: sentenceCase(kind.replace(/[-_]+/g, ' '))}
}

/**
 * Graph card text in card units at the type scale's default extra-small size (12); a theme with another size scales
 * the advances (`textScale`, its size over 12). Advances are rounded up from monospace's 0.6 em and the sans fonts'
 * average, so text never needs more room than a card makes for it.
 */
export const cardTextMetrics = {
  /** Space between a card's sides and its text. */
  inset: 16,
  /** Space a comparison's centred status keeps from the card's sides; a status wider than the rest is cut short. */
  footerInset: 8,
  /** Where a file card's text starts, after its icon. */
  fileInset: 40,
  /** Baselines from a card's top: its first line (the kind line, or a file's path), and the label under a kind line. */
  firstBaseline: 21,
  labelBaseline: 41,
  /** Advance of a character of code (identifiers, versions, paths), of human text, and of a semibold label in sans. */
  monoAdvance: 7.4,
  proseAdvance: 6.6,
  labelAdvance: 7,
  /** Space between a kind line (and its note) and the detail at the card's right. */
  detailGap: 8,
  /** Most characters of a detail (a version) a card shows; longer ones end in an ellipsis. */
  detailLength: 14,
} as const

/**
 * The room for one row of text in a card's footer band (a change line such as `Lifetime Scoped → Singleton`, above
 * the status), in card units: the card's `width` less its text inset on each side. Footer rows are centred on the
 * card (see `SvgFooterRow`), so text laid out within this keeps the inset from both sides; longer text wraps onto
 * more rows.
 */
export function cardFooterRoom(width: number): number {
  return width - 2 * cardTextMetrics.inset
}

/**
 * The narrowest and widest graph card, in card units (the widest grows by an icon's room on a card with an icon, see
 * `GraphCanvasProps.icon`). A graph's cards share one width, what its longest card text needs between the two (see
 * `graphCardWidth`), so a graph of short names packs densely and its layers stay aligned;
 * text longer than the widest card holds is cut short with an ellipsis, and the card's tooltip has it whole.
 */
export const cardWidthRange = {min: 112, max: 216} as const

/** The style text is drawn in on a card: code in monospace, human text in sans, and a sans label in semibold. */
export type CardTextStyle = 'mono' | 'prose' | 'label'

/** Width of `text` drawn in `style`, in card units, at `textScale` times the default size. */
export function cardTextWidth(text: string, style: CardTextStyle, textScale = 1): number {
  const m = cardTextMetrics
  return text.length * (style === 'mono' ? m.monoAdvance : style === 'prose' ? m.proseAdvance : m.labelAdvance) * textScale
}

/** `text` cut to at most `room` characters: whole when it fits, else its start and an ellipsis. */
export function cutText(text: string, room: number): string {
  return text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`
}

/**
 * A card's subtitle (see `GraphCanvasProps.subtitle`): human text under the label, `line` apart, its first baseline
 * `gap` under the text above it, on at most `lines` lines.
 */
export const subtitleMetrics = {line: 16, gap: 17, lines: 3} as const

/**
 * Human text in sans on lines `room` card units wide: whole words fill each line (a word wider than a line is cut), and
 * text needing more than `max` lines ends its last in an ellipsis. Empty text is no lines.
 */
export function proseLines(text: string, room: number, textScale = 1, max: number = subtitleMetrics.lines): string[] {
  const fits = Math.max(1, Math.floor(room / cardTextWidth('x', 'prose', textScale)))
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= fits) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = word
    if (lines.length === max) {
      line = ''
      break
    }
  }
  if (line) lines.push(line)
  const cut = lines.length > max || lines.join(' ').length < words.join(' ').length
  const shown = lines.slice(0, max).map(item => cutText(item, fits))
  if (cut && shown.length) {
    shown[shown.length - 1] = `${shown
      .at(-1)!
      .slice(0, Math.max(1, fits - 1))
      .replace(/\s+$/, '')}…`
  }
  return shown
}

/** Most characters of a kind line a boundary's heading shows; longer ones keep their end, the most specific part. */
export const kindLineLength = 25

/** A kind line cut to `room` characters, keeping its end: path-like kinds lose whole leading segments first. */
export function kindText(text: string, room = kindLineLength): string {
  if (text.length <= room) return text
  // Path-like kinds (`virtualMachines/extensions`) lose whole leading segments first.
  const segments = text.split('/')
  while (segments.length > 1) {
    segments.shift()
    const shorter = `…/${segments.join('/')}`
    if (shorter.length <= room) return shorter
  }
  return `…${text.slice(text.length - Math.max(1, room) + 1)}`
}

/** A detail (a version) as a card shows it: at most `cardTextMetrics.detailLength` characters. */
export function detailText(text: string): string {
  return cutText(text, cardTextMetrics.detailLength)
}

/** The note after a kind line (the renderer's, then `Inferred`), or nothing. */
export function kindNote(kind: KindLineText | undefined, inferred: boolean): string {
  return [kind?.note, inferred ? 'Inferred' : undefined].filter(Boolean).join(' · ')
}

/** What decides a graph card's width, besides its entity: the renderer's card text (see `GraphCanvasProps`). */
export interface GraphCardText {
  /** The renderer's kind line for an entity (`GraphCanvasProps.kindLine`); `entityKindLine` of its kind otherwise. */
  kindLine?: ((entity: Entity) => KindLineText | undefined) | undefined
  /** A short code identifier right of the kind line, such as a version, cut to `cardTextMetrics.detailLength`. */
  detail?: ((entity: Entity) => string | undefined) | undefined
  /** Whether an entity's label is human language, measured in semibold sans; otherwise it is measured as code. */
  prose?: ((entity: Entity) => boolean) | undefined
  /** A card's icon before its kind line (`GraphCanvasProps.icon`), which the kind line makes room for. */
  icon?: ((entity: Entity) => string | undefined) | undefined
  /**
   * In a comparison, the parts of a row's status footer (the domain's wording, else the comparison's own), which the
   * card makes room for; leave it out for one revision, which has no status.
   */
  status?: ((row: EntityChange<Entity>) => readonly StatusPart[] | undefined) | undefined
  /** Whether the card shows a comparison, so its width also holds the status footer; one revision has none. */
  comparing?: boolean
  /** The theme's extra-small type size over the default 12: text, and the cards that hold it, scale with it. */
  textScale?: number
}

/**
 * The width a graph card's text needs: its widest line in either revision (the kind line with its icon, its note and
 * the detail at its right, the label, and in a comparison the status footer), between `cardWidthRange.min` and `.max`,
 * rounded up to a multiple of 4. A graph's cards share the widest of their widths (see `graphCardsWidth`), the same
 * at every progress, so no card resizes while scrubbing.
 */
export function graphCardWidth(row: EntityChange<Entity>, text: GraphCardText = {}): number {
  const m = cardTextMetrics
  const scale = text.textScale ?? 1
  const sides = [row.before, row.after].filter((side): side is Entity => side !== undefined)
  const details = sides.map(side => text.detail?.(side)).filter((value): value is string => Boolean(value))
  const detail = Math.max(0, ...details.map(value => cardTextWidth(detailText(value), 'mono', scale)))
  const iconRoom = hasIcon(row, text.icon) ? cardIconRoom : 0
  let need = 0
  for (const entity of sides) {
    const label = cardTextWidth(entity.label, text.prose?.(entity) ? 'label' : 'mono', scale)
    if (entity.kind === 'file') {
      need = Math.max(need, m.fileInset + label + m.inset)
      continue
    }
    const kind = text.kindLine?.(entity) ?? entityKindLine(entity.kind)
    const note = kindNote(kind, entity.confidence === 'inferred')
    const kindWidth =
      iconRoom +
      cardTextWidth(kind.text, kind.identifier ? 'mono' : 'prose', scale) +
      (note ? cardTextWidth(` · ${note}`, 'prose', scale) : 0)
    need = Math.max(need, 2 * m.inset + Math.max(label, kindWidth + (detail ? m.detailGap + detail : 0)))
  }
  if (text.comparing) {
    const parts = text.status?.(row) ?? statusParts(row)
    need = Math.max(need, 2 * m.inset + svgStatusWidth(parts, row, scale))
  }
  // An icon takes room of its own: the widest card is that much wider, so its text keeps the room it had.
  return Math.min(cardWidthRange.max + Math.ceil(iconRoom), Math.max(cardWidthRange.min, Math.ceil(need / 4) * 4))
}

/** The one width a graph's cards share: the widest any of its rows' text needs (see `graphCardWidth`). */
export function graphCardsWidth(rows: readonly EntityChange<Entity>[], text: GraphCardText = {}): number {
  return rows.reduce<number>((widest, row) => Math.max(widest, graphCardWidth(row, text)), cardWidthRange.min)
}
