// Where a diff that opens zoomed starts: on its first change, so a change is in view even when it is far from the top.

/** Room left above and beside the change a diff opens on, CSS px. */
const margin = 16

/**
 * The scroll offsets, at `scale`, that put the diff's first change (the topmost, then leftmost, of the cards, rows, tags and links it
 * marks with `data-change`, a link at the row it leaves) at the view's top left, `margin` clear of it: read from
 * `drawn` (the drawn schema, scaled by a transform) in content units, so the start is the same at every scale. The
 * hidden copies tags are measured from don't count, and a tag waiting for its slot counts as the tag block. The top
 * left without a change.
 */
export function changesStart(scroller: HTMLElement | null, drawn: HTMLElement | null, scale: number): {left: number; top: number} {
  if (!scroller || !drawn || drawn.offsetWidth === 0) return {left: 0, top: 0}
  const box = drawn.getBoundingClientRect()
  const unit = box.width / drawn.offsetWidth
  const marked = [...drawn.querySelectorAll('[data-change]')].filter(element => !element.closest('.database-tags-measure'))
  const places = marked
    .map(element => corner(element))
    .filter(place => place !== undefined)
    .map(place => ({x: (place.x - box.left) / unit, y: (place.y - box.top) / unit}))
  if (!places.length) return {left: 0, top: 0}
  const first = places.reduce((best, place) => (place.y < best.y || (place.y === best.y && place.x < best.x) ? place : best))
  // Content that overflows the view (the only kind a start places) starts after the view's padding.
  const style = getComputedStyle(scroller)
  return {
    left: Number.parseFloat(style.paddingLeft) + first.x * scale - margin,
    top: Number.parseFloat(style.paddingTop) + first.y * scale - margin,
  }
}

/** Where a marked element begins on screen: a link where it leaves its row, a tag in its slot (else the tag block). */
function corner(element: Element): {x: number; y: number} | undefined {
  if (element.closest('svg')) {
    const link = element.querySelector<SVGPathElement>('path.database-link')
    const matrix = link?.getScreenCTM()
    if (!link || !matrix || !link.getTotalLength()) return undefined
    const start = link.getPointAtLength(0)
    const point = new DOMPoint(start.x, start.y).matrixTransform(matrix)
    return {x: point.x, y: point.y}
  }
  const slot = element.closest('.database-tag-slot')
  const shown = slot && getComputedStyle(slot).visibility === 'hidden' ? slot.closest('.database-tags')! : element
  const rect = shown.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0 ? {x: rect.left, y: rect.top} : undefined
}
