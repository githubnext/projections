/**
 * Card borders and where arrowheads stop. A relationship's arrowhead touches
 * its target card: the painted tip (round join included) ends exactly on the
 * outer edge of the card's painted border, covering none of it. Kit cards
 * drawn in SVG stroke their outline centred on the card's box, so the border
 * reaches half its width outside the box, and that is how far the tip stays
 * out (`cardBorderOutset`). A change border is thicker; it is inset by the
 * difference (`emphasisInset`), so its outer edge is the plain border's and a
 * card's outline never grows toward an arrowhead.
 */

/** The theme's border widths in CSS px: `--stroke` and `--stroke-strong` (the host's border width tokens). */
export interface BorderWidths {
  /** A plain card's border, `--stroke`; it decides how far an arrowhead stops short of a card (`cardBorderOutset`). */
  normal: number
  /** A change border, `--stroke-strong`, drawn inset so its outer edge matches the plain border's (`emphasisInset`). */
  strong: number
}

/** The default theme's widths, used before the document's are read. */
export const defaultBorderWidths: BorderWidths = {normal: 1, strong: 2}

/** The border widths in effect on `element`, falling back to the defaults where unset. */
export function readBorderWidths(element: Element | null): BorderWidths {
  if (!element) return defaultBorderWidths
  const style = getComputedStyle(element)
  const read = (name: string, fallback: number) => {
    const value = Number.parseFloat(style.getPropertyValue(name))
    return Number.isFinite(value) && value >= 0 ? value : fallback
  }
  return {normal: read('--stroke', defaultBorderWidths.normal), strong: read('--stroke-strong', defaultBorderWidths.strong)}
}

/** How far a kit card's border (an SVG stroke centred on its box) reaches outside the box: where an arrowhead's tip stops. */
export function cardBorderOutset(widths: BorderWidths = defaultBorderWidths): number {
  return widths.normal / 2
}

/** How far a change border (`strong`) is inset from the card's box, so its outer edge is the plain border's. */
export function emphasisInset(widths: BorderWidths = defaultBorderWidths): number {
  return Math.max(0, (widths.strong - widths.normal) / 2)
}
