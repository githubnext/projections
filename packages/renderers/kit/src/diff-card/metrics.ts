import type {Entity} from '@githubnext/projections-schemas'
import {cardTextMetrics} from '../card-text.js'
import type {FieldLine} from '../diff/lines.js'
import type {StatusPart} from '../emphasis.js'

/**
 * A graph card's text in diff mode, laid out whole: nothing is cut off with an
 * ellipsis. The card is as wide as its longest line needs, up to the widest
 * card (`cardWidthRange`); longer names, types, versions and field values wrap
 * onto more lines (breaking after `_ . / - , :` first, see `wrapText`) and the
 * card grows to hold them; the union layout places the taller cards. Positions
 * are in card units from the card's top-left corner.
 */
export interface DiffCardText {
  /** Every line of text, top to bottom, each at its own position: draw them as they are (see `DiffCardLines`). */
  lines: DiffCardLine[]
  /** The card's width: what its text needs on one line, within `cardWidthRange`. */
  width: number
  /** The card's height: its kind's own height, or taller for its text, footer included. */
  height: number
}

/** One line of a diff card's text: an SVG `<text>` at (`x`, `y`) made of styled spans. */
export interface DiffCardLine {
  /** Where the line starts, from the card's left side; where it ends when `anchor` is `end`. */
  x: number
  /** Text baseline, from the card's top. */
  y: number
  /** `end` for a line aligned to the card's right (a detail beside the kind line); starts at `x` otherwise. */
  anchor?: 'end'
  /**
   * The line's role, for its style: `node-kind`, `node-label`, `node-detail`, `node-field-key` or
   * `node-field-value`.
   */
  className: string
  /** Drawn in the monospace font (an identifier or value). */
  identifier: boolean
  /** The line's text in runs, each in its own tone. */
  spans: DiffCardSpan[]
}

/** A run of a diff card line's text in one tone. */
export interface DiffCardSpan {
  /** The text, verbatim. */
  text: string
  /** `was` (struck, removed hue), `now` (added hue), `arrow` or `note` (muted sans). */
  tone?: 'was' | 'now' | 'arrow' | 'note'
}

/** What `diffCardText` lays out: an entity row's two versions and the renderer's card text for it. */
export interface DiffCardInput {
  /** The entity in the Before revision; at least one of `before` and `after` must be given. */
  before?: Entity | undefined
  /** The entity in the After revision; its kind is drawn, else Before's, and a changed label shows both. */
  after?: Entity | undefined
  /** The card's kind line (see `GraphCanvasProps.kindLine`); the entity's kind otherwise. */
  kind?: {text: string; identifier?: boolean; note?: string} | undefined
  /** Whether the card shows an icon before its kind line (see `GraphCanvasProps.icon`), which its kind line makes room for. */
  icon?: boolean | undefined
  /** A short identifier at the right of the kind line, per revision (see `GraphCanvasProps.detail`). */
  detail?: ((entity: Entity) => string | undefined) | undefined
  /** The label is human language, drawn in sans. */
  prose?: boolean
  /** Field changes drawn under the label (see `GraphCanvasProps.changedFields`), at most `fieldLineLimit`. */
  fields?: readonly FieldLine[] | undefined
  /** The parts of the card's status footer (see `SvgChangeStatus`), which the card is wide enough to hold. */
  status?: readonly StatusPart[] | undefined
  /** The theme's extra-small type size over the default 12 (see `GraphCardText.textScale`). */
  textScale?: number | undefined
  /** Room kept free at the right of the kind line, for an expander (see `EntityCard`). */
  reserve?: number | undefined
  /**
   * The card's width, when the graph's cards share one (at least what this card's text needs on one line, see
   * `DiffCardText.width`); by default the card's own.
   */
  width?: number | undefined
}

/**
 * Card geometry in card units: text runs from `textLeft` (`fileTextLeft` on a file card, after its icon) to
 * `textInset` before the card's right side. Advances are at the type scale's default size (12): `textScale` scales them.
 */
export const diffCardMetrics = {
  textLeft: cardTextMetrics.inset,
  textInset: cardTextMetrics.inset,
  fileTextLeft: cardTextMetrics.fileInset,
  /** Advance of one character at the card's text size (12px), rounded up so text never needs more room than reserved. */
  charWidth: cardTextMetrics.monoAdvance,
  firstBaseline: cardTextMetrics.firstBaseline,
  line: 14,
  /** Extra space above the label, and above the field changes. */
  labelGap: 6,
  fieldsGap: 6,
  fieldGap: 2,
  /** Space under the last line, above the footer. */
  bottom: 15,
  fieldLineLimit: 3,
  /** Advance of one character of human text (a kind line in words), narrower than the monospace one. */
  proseCharWidth: cardTextMetrics.proseAdvance,
  /** A field value longer than this many lines is left to the detail panel: the card says so instead of showing part of it. */
  valueLineLimit: 6,
} as const
