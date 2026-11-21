// An HTML element's box as the spacing check sees it: border widths, spacing and corner radii.
import {px} from '../paint.js'

const sides = ['top', 'right', 'bottom', 'left'] as const
const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const

/** The widths of the borders an element draws, by side. */
export function borderWidths(style: CSSStyleDeclaration): Record<string, number> {
  const borders: Record<string, number> = {}
  for (const side of sides) {
    const width = px(style.getPropertyValue(`border-${side}-width`))
    if (width > 0 && !['none', 'hidden'].includes(style.getPropertyValue(`border-${side}-style`))) borders[side] = width
  }
  return borders
}

/** Padding, margins and flex or grid gaps, in px; auto and percentage values are layout, not spacing, and left out. */
export function spacingOf(element: Element, style: CSSStyleDeclaration, box: DOMRect): Record<string, number> {
  const spacing: Record<string, number> = {}
  // Auto margins and percentages are layout, not spacing: computed values (CSS Typed OM) keep them as written,
  // where getComputedStyle reports the used length.
  const computed = (
    element as Element & {computedStyleMap?: () => {get: (property: string) => {toString: () => string} | undefined}}
  ).computedStyleMap?.()
  const layout = (property: string) => {
    const value = computed?.get(property)?.toString() ?? ''
    return value === 'auto' || value.endsWith('%')
  }
  for (const side of sides) if (!layout(`padding-${side}`)) spacing[`padding-${side}`] = px(style.getPropertyValue(`padding-${side}`))
  const margins = sides.map(side => px(style.getPropertyValue(`margin-${side}`)))
  const [, right, , left] = margins
  // Without Typed OM, equal side margins on a narrower block are taken as auto centring.
  const centred =
    !computed &&
    left! > 0 &&
    Math.abs(left! - right!) < 1 &&
    element.parentElement &&
    box.width < element.parentElement.getBoundingClientRect().width
  sides.forEach((side, at) => {
    if (layout(`margin-${side}`) || (centred && (side === 'left' || side === 'right'))) return
    spacing[`margin-${side}`] = margins[at]!
  })
  if (/flex|grid/.test(style.display)) {
    for (const property of ['row-gap', 'column-gap']) {
      const value = style.getPropertyValue(property)
      if (value.endsWith('px')) spacing[property] = px(value)
    }
  }
  return spacing
}

/** Corner radii in px, or `pill` when fully rounded (a percentage, or at least half the shorter side). */
export function radiiOf(style: CSSStyleDeclaration, box: DOMRect): Record<string, number | 'pill'> {
  const radii: Record<string, number | 'pill'> = {}
  for (const corner of corners) {
    const value = style.getPropertyValue(`border-${corner}-radius`)
    if (!value || value === '0px') continue
    if (value.includes('%')) {
      radii[corner] = 'pill'
      continue
    }
    const radius = px(value)
    radii[corner] = radius >= Math.min(box.width, box.height) / 2 - 0.5 ? 'pill' : radius
  }
  return radii
}
