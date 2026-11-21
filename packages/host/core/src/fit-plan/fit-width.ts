const px = (value: string) => Number.parseFloat(value) || 0

/**
 * The width an element needs at its minimums. `data-fit-min` elements (the slider, spacers) need that many pixels;
 * `data-fit="row"` containers need their padding, border, gaps and their in-flow children's needs; `column`
 * containers the widest child's; `centre` containers (three children, the middle one centred) the middle child's and
 * twice the wider side's, so the middle one stays centred; anything else (blocks that never shrink) its current width.
 */
export function fitWidth(element: Element): number {
  const min = element.getAttribute('data-fit-min')
  if (min !== null) return Number(min)
  const fit = element.getAttribute('data-fit')
  if (!fit) return element.getBoundingClientRect().width
  const view = element.ownerDocument.defaultView!
  const style = view.getComputedStyle(element)
  const frame = px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth)
  const items = [...element.children].filter(child => {
    const item = view.getComputedStyle(child)
    return item.display !== 'none' && item.position !== 'absolute' && item.position !== 'fixed'
  })
  const widths = items.map(fitWidth)
  if (fit === 'column') return frame + Math.max(0, ...widths)
  if (fit === 'centre' && widths.length === 3) {
    const [start, middle, end] = widths as [number, number, number]
    return frame + middle + 2 * Math.max(start, end) + 2 * px(style.columnGap)
  }
  return frame + widths.reduce((sum, width) => sum + width, 0) + px(style.columnGap) * Math.max(0, items.length - 1)
}
