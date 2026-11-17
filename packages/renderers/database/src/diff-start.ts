// Where a diff that opens zoomed starts: on its first change, so a change is in view even when it is far from the top.
import type {RefObject} from 'react'
import type {ScrollStart} from '@githubnext/projections-renderer-kit'

/** Room left above and beside the change a diff opens on, CSS px. */
const margin = 16

/**
 * The scroll offsets that put the diff's first change (the topmost, then leftmost, of the cards, rows and tags it marks
 * with `data-change`; its relationships are lines read from them) at the view's top left, `margin` clear of it: read
 * from `content` (the drawn schema, scaled by a transform) in content units, so the start is the same at every scale. A tag waiting for its slot counts as the tag block. The top left without a change.
 */
export function changesStart(view: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>): ScrollStart {
  return ({scale}) => {
    const [scroller, drawn] = [view.current, content.current]
    if (!scroller || !drawn || !drawn.offsetWidth) return {left: 0, top: 0}
    const box = drawn.getBoundingClientRect()
    const unit = box.width / drawn.offsetWidth
    const marked = [...drawn.querySelectorAll<HTMLElement>('[data-change]')].filter(element => !element.closest('svg'))
    const places = marked
      .map(element => {
        const slot = element.closest('.database-tag-slot')
        return slot && getComputedStyle(slot).visibility === 'hidden' ? slot.closest('.database-tags')! : element
      })
      .map(element => element.getBoundingClientRect())
      .filter(rect => rect.width > 0 || rect.height > 0)
      .map(rect => ({x: (rect.left - box.left) / unit, y: (rect.top - box.top) / unit}))
    if (!places.length) return {left: 0, top: 0}
    const first = places.reduce((best, place) => (place.y < best.y || (place.y === best.y && place.x < best.x) ? place : best))
    // Content that overflows the view (the only kind a start places) starts after the view's padding.
    const style = getComputedStyle(scroller)
    return {
      left: parseFloat(style.paddingLeft) + first.x * scale - margin,
      top: parseFloat(style.paddingTop) + first.y * scale - margin,
    }
  }
}
