// Content past its bounds: a document wider than its viewport, and elements that cut off their own content.
import type {OverflowMeasurement} from '../types.js'
import {visuallyHidden, visible, describe} from './paint.js'

/** How far the document extends past its viewport, and the outermost elements that do. */
export function horizontalOverflow(): OverflowMeasurement {
  const root = document.documentElement
  const width = root.clientWidth
  const offenders: Element[] = []
  const clipped = (element: Element) => {
    for (let node = element.parentElement; node && node !== root && node !== document.body; node = node.parentElement) {
      if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(node).overflowX)) return true
    }
    return false
  }
  for (const element of document.body.querySelectorAll('*')) {
    if (offenders.length >= 5) break
    if (offenders.some(offender => offender.contains(element))) continue
    const box = element.getBoundingClientRect()
    if (box.right > width + 1 && box.width > 0 && !clipped(element) && visible(element)) offenders.push(element)
  }
  return {scrollWidth: Math.max(root.scrollWidth, document.body.scrollWidth), clientWidth: width, offenders: offenders.map(describe)}
}

/**
 * Elements that cut off their own content: `overflow` hidden or clip on an
 * axis with more content than fits on it, for example a row collapsed to a
 * zero-height track or text pushed past a fixed box. Scroll containers, text
 * truncated with an ellipsis or a line clamp, and visually hidden content
 * (`sr-only`) are deliberate and don't count.
 */
export function clippedContent(root: Element = document.body): string[] {
  const found: string[] = []
  for (const element of root.querySelectorAll('*')) {
    if (found.length >= 10) break
    if (!(element instanceof HTMLElement) || !visible(element)) continue
    const style = getComputedStyle(element)
    if (visuallyHidden(element, style)) continue
    const cuts = (overflow: string) => overflow === 'hidden' || overflow === 'clip'
    const truncated = style.textOverflow === 'ellipsis' || (style.getPropertyValue('-webkit-line-clamp') || 'none') !== 'none'
    const vertical = cuts(style.overflowY) && !truncated && element.scrollHeight > element.clientHeight + 1
    const horizontal = cuts(style.overflowX) && !truncated && element.scrollWidth > element.clientWidth + 1
    if (!vertical && !horizontal) continue
    if (found.some(text => text.startsWith(describe(element)))) continue
    found.push(
      `${describe(element)} shows ${element.clientWidth}×${element.clientHeight}px of its ${element.scrollWidth}×${element.scrollHeight}px content`,
    )
  }
  return found
}
