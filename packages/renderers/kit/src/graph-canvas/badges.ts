// A card's badges: their geometry, and how they are laid out in rows under a card's text.
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {cardTextMetrics, cardTextWidth, cardWidthRange, cutText} from '../card-text.js'

/**
 * A pill around one line of card text at the type scale's default size (12), aligned optically rather than by its box:
 * the space above a capital E's top, below its baseline, left of its stem and right of a last capital H's right stem is
 * about the same (to within a card unit: the pill is a whole number of them wide), with every edge on a whole card unit. The text's baseline is `baseline` under the
 * pill's top: the sans fonts' cap height is about 8.6 card units, which leaves about 4.4 above it and 4 below. Its
 * `padding` beyond the text's advance on each side is 3, which the glyphs' own side bearings (about 1 card unit) make
 * about 4 to their stems. Measured from rendered pixels with the renderer testing package's `opticalInsets`. See
 * `textPill`.
 */
export const pillMetrics = {height: 17, baseline: 13, padding: 3} as const

/**
 * The box of a pill (see `pillMetrics`) around one line of text `advance` card units wide, its baseline at `baseline`,
 * starting at `x` or, anchored at its `end`, ending there. The pill is a whole number of card units wide.
 */
export function textPill(
  x: number,
  baseline: number,
  advance: number,
  anchor: 'start' | 'end' = 'start',
): {x: number; y: number; width: number; height: number} {
  const width = Math.round(advance + 2 * pillMetrics.padding)
  return {
    x: anchor === 'end' ? x + pillMetrics.padding - width : x - pillMetrics.padding,
    y: baseline - pillMetrics.baseline,
    width,
    height: pillMetrics.height,
  }
}

/**
 * Badge geometry: a pill's height, its text's inset, the gap between pills and the pitch of their rows; a highlight's
 * icon and the space after it; and the gap between quiet tags.
 */
export const badgeMetrics = {height: 16, inset: 6, gap: 4, row: 20, accent: 4, icon: 10, iconGap: 4, tagGap: 10}

/** A card's accent: its paint, and what it means in words (`scope: secret`), for assistive technology. */
export interface CardAccent {
  /** CSS paint: a color or a theme token's variable. */
  paint: string
  /** What the color means, added to the card's accessible name; empty when the card already says it (its kind). */
  label: string
  /**
   * The category the color stands for (`Rust`, a kind), when it is a categorical color: a language's own color isn't a
   * theme token, so the band is marked `data-projections-category` with it, as categorical marks are.
   */
  category?: string
}

/**
 * A badge: code, drawn in monospace on a pill, or `{text, prose: true}`, human words in sans on a pill. Its `tone`
 * sets it apart: a `highlight` (words, with a shield check, in the accent hue) is a fact to see first, such as how it
 * is formally verified; a `quiet` one is a code tag without a pill, muted, on rows of its own after the pills (where
 * it runs, say).
 */
export type CardBadge = string | {text: string; prose?: true; tone?: 'highlight' | 'quiet'}

/** A badge's text. */
export const badgeText = (badge: CardBadge): string => (typeof badge === 'string' ? badge : badge.text)
/** A badge's tone (see `CardBadge`). */
const badgeTone = (badge: CardBadge) => (typeof badge === 'string' ? undefined : badge.tone)
/** The style a badge's text is drawn in: highlights are semibold words, quiet tags code. */
const badgeStyle = (badge: CardBadge) =>
  typeof badge === 'string' || badge.tone === 'quiet' ? 'mono' : badge.tone === 'highlight' ? 'label' : badge.prose ? 'prose' : 'mono'
/** The room a badge takes besides its text: a pill's insets, and a highlight's icon. */
const badgeChrome = (badge: CardBadge) =>
  badgeTone(badge) === 'quiet'
    ? 0
    : 2 * badgeMetrics.inset + (badgeTone(badge) === 'highlight' ? badgeMetrics.icon + badgeMetrics.iconGap : 0)

interface Placed {
  text: string
  prose: boolean
  tone: 'highlight' | 'quiet' | undefined
  x: number
  row: number
  width: number
}

/**
 * Badges in rows `room` wide, each as wide as its text; one too wide for a row ends in an ellipsis. Quiet tags start a
 * row of their own after the pills.
 */
export function placeBadges(values: readonly CardBadge[], room: number, textScale = 1): Placed[] {
  const placed: Placed[] = []
  let x = 0,
    row = 0
  for (const value of values) {
    const style = badgeStyle(value)
    const tone = badgeTone(value)
    const advance = cardTextWidth('x', style, textScale)
    const inner = Math.max(advance, room - badgeChrome(value))
    const text = cutText(badgeText(value), Math.floor(inner / advance))
    const width = cardTextWidth(text, style, textScale) + badgeChrome(value)
    const after = placed.at(-1)
    if (x > 0 && (x + width > room || (tone === 'quiet' && after?.tone !== 'quiet'))) {
      x = 0
      row++
    }
    placed.push({text, prose: style !== 'mono', tone, x, row, width})
    x += width + (tone === 'quiet' ? badgeMetrics.tagGap : badgeMetrics.gap)
  }
  return placed
}

/** The widest a badge makes a graph's cards: half again the card range's most. */
const badgeWidthLimit = Math.round(cardWidthRange.max * 1.5)

/**
 * The card width the widest single badge needs, so one badge never ends in an ellipsis: at least the card range's
 * least, and past its most when a badge needs it, up to `badgeWidthLimit`.
 */
export function badgeCardWidth(
  rows: readonly EntityChange<Entity>[],
  badges: ((entity: Entity) => readonly CardBadge[] | undefined) | undefined,
  textScale = 1,
): number {
  let widest = 0
  for (const row of rows) {
    for (const side of [row.before, row.after]) {
      for (const value of (side && badges?.(side)) || []) {
        widest = Math.max(widest, cardTextWidth(badgeText(value), badgeStyle(value), textScale) + badgeChrome(value))
      }
    }
  }
  if (!widest) return cardWidthRange.min
  return Math.min(badgeWidthLimit, Math.ceil((widest + 2 * cardTextMetrics.inset) / 4) * 4)
}

/** Both revisions' badges in one list: the after revision's, then those only the before revision has. */
export function unionBadges(before: readonly CardBadge[], after: readonly CardBadge[]): CardBadge[] {
  const seen = new Set(after.map(badgeText))
  return [...after, ...before.filter(badge => !seen.has(badgeText(badge)))]
}

/** The width a card's badges may take: its text's room. */
export function badgeRoom(cardWidth: number): number {
  return cardWidth - 2 * cardTextMetrics.inset
}

/**
 * How much taller each card grows for its badge rows: as many rows as either revision's badges need (both together in
 * the diff), so a card never resizes while scrubbing. Rows without badges grow nothing.
 */
export function badgeGrowth(
  rows: readonly EntityChange<Entity>[],
  badges: (entity: Entity) => readonly CardBadge[] | undefined,
  widths: ReadonlyMap<string, number>,
  textScale: number,
): Map<string, number> {
  const growth = new Map<string, number>()
  for (const row of rows) {
    const [before, after] = [row.before, row.after].map(side => (side ? (badges(side) ?? []) : []))
    const room = badgeRoom(widths.get(row.id) ?? 0)
    const count = (values: readonly CardBadge[]) => (values.length ? placeBadges(values, room, textScale).at(-1)!.row + 1 : 0)
    const lines = Math.max(count(before!), count(after!), count(unionBadges(before!, after!)))
    if (lines) growth.set(row.id, lines * badgeMetrics.row)
  }
  return growth
}
