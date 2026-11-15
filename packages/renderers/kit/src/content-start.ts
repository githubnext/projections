// Where content that overflows its opening view starts: its top row, with no card cut at the view's left edge.

/** A box in content units, by its top-left corner. */
export interface ContentBox {
  /** The box's left side. */
  x: number
  /** The box's top side. */
  y: number
  /** The box's width. */
  width: number
  /** The box's height. */
  height: number
}

/**
 * The reading start of content whose bounds are `bounds` (content units), drawn after `inset` CSS px of padding (or
 * `{x, y}`, across and down):
 * the scroll offsets that put the content's top row of boxes (those whose top is within the smallest box's height
 * of the topmost) at the viewport's top left, from its leftmost box, `margin` units clear of it. So content whose
 * bounds start with empty room (a wide layout whose top row is at the right) opens on cards, never on empty
 * canvas. It depends only on the boxes, the scale and the viewport's size, never on highlighting, and the view is
 * placed again as a frame settles to its height. The scroll range clamps it where the content ends.
 *
 * Its left edge runs between boxes, never through one, counting the boxes the viewport reaches (by its height when
 * given) that hold no other (cards, not the groups around them): where it would cut one, it moves to the nearest edge,
 * `margin` clear of a box and within the scroll range, that cuts none and keeps the top row's leftmost box whole in
 * view (by the viewport's width), else at least that box's left side; where there is none, the start is the
 * drawing's own left side.
 *
 * `align: 'centre'` puts the top row's horizontal middle at the viewport's instead, for a layout that reads from its
 * top row outward (a graph laid out top to bottom), so the row is cut evenly on both sides even when it sits to one
 * side of the content (cards placed beside it, or another moment of a transition, widen the bounds). A row too wide
 * for the viewport opens from its leftmost box instead, as `'left'` does, never cut at the left.
 *
 * `clear` keeps that many more CSS px clear at the view's left, beside `margin`, reaching into the padding: content
 * drawn flush with a host's stage inset (`inset.x` and `clear` the same) opens with its leftmost box that inset from
 * the view's edge, on the host's column.
 */
export function contentStart(
  boxes: readonly ContentBox[],
  bounds: ContentBox,
  inset: number | {x: number; y: number} = 0,
  margin = 12,
  align: 'left' | 'centre' = 'left',
  clear = 0,
): (view: {scale: number; width?: number; height?: number}) => {left: number; top: number} {
  if (!boxes.length) return () => ({left: 0, top: 0})
  const pad = typeof inset === 'number' ? {x: inset, y: inset} : inset
  const top = Math.min(...boxes.map(box => box.y))
  const band = Math.min(...boxes.map(box => box.height))
  const row = boxes.filter(box => box.y <= top + band)
  const first = row.reduce((leftmost, box) => (box.x < leftmost.x ? box : leftmost))
  const middle = (first.x + Math.max(...row.map(box => box.x + box.width))) / 2
  const y = Math.max(bounds.y, top - margin)
  // Boxes that hold no other: cards, not the groups around them, whose frames the view may cross.
  const inside = (inner: ContentBox, outer: ContentBox) =>
    inner !== outer &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  const cards = boxes.filter(box => !boxes.some(other => inside(other, box)))
  return ({scale, width = 0, height = Infinity}) => {
    if (!scale) return {left: 0, top: 0}
    // Clear of a box across: `margin`, and `clear` CSS px more, which may reach into the padding before `bounds.x`.
    const across = margin + clear / scale,
      least = bounds.x - Math.min(pad.x, clear) / scale
    const x = Math.max(least, first.x - across)
    // The view's left edge in content units, within the scroll range: the row's left, or its middle centred where the
    // row fits.
    // The scroll range is the bounds and `inset` on each side; an edge at `bounds.x` scrolls by `inset`.
    const end = width ? bounds.x + bounds.width + (pad.x - width) / scale : Infinity
    const within = (edge: number) => Math.max(least, Math.min(end, edge))
    const start = within(align === 'centre' ? Math.min(x, middle - width / scale / 2) : x)
    const reached = cards.filter(box => box.y < y + height / scale)
    const cuts = (edge: number) => reached.some(box => box.x < edge - 0.5 && edge + 0.5 < box.x + box.width)
    const edges = [start, ...reached.flatMap(box => [box.x - across, box.x + box.width + across]).map(within)].filter(edge => !cuts(edge))
    const nearest = (from: number, to: number) =>
      edges.filter(edge => edge >= from && edge <= to).sort((a, b) => Math.abs(a - start) - Math.abs(b - start))[0]
    // The nearest edge that cuts no box and keeps the row's leftmost box whole, else at least its left side in view,
    // else the drawing's own left side.
    const span = width ? width / scale : Infinity,
      most = Math.max(start, first.x - across)
    const left = nearest(first.x + first.width - span, most) ?? nearest(first.x - span + 1, most) ?? least
    return {left: (left - bounds.x) * scale + pad.x, top: (y - bounds.y) * scale + pad.y}
  }
}
