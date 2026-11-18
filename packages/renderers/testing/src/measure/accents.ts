// Change and accent colors drawn inside one another (probe call `accents`).
import type {AccentFamily, AccentPaint, NestedAccent} from '../types.js'
import {describe, visible, visuallyHidden} from './paint.js'
import {familyHues, paintsOf} from './accents/hues.js'
import type {Paint} from './accents/hues.js'

interface Painted {
  element: Element
  order: number
  /** A surface encloses what is drawn on it: an HTML background or border, an SVG shape's fill or outline. */
  surface: Paint | undefined
  /** Every hued paint, including text and lines. */
  paints: Paint[]
  box: DOMRect
}

/** Whether an SVG element encloses what it paints: a filled shape, or a closed outline. */
function svgSurface(element: Element, style: CSSStyleDeclaration): boolean {
  if (!(element instanceof SVGGeometryElement) || element instanceof SVGLineElement || element instanceof SVGPolylineElement) return false
  // A path encloses when it is filled, or closed (an outline drawn round something).
  if (element instanceof SVGPathElement)
    return (
      (style.fill !== 'none' && !/^(rgba?\(.*,\s*0\)|transparent)$/.test(style.fill)) || /[zZ]\s*$/.test(element.getAttribute('d') ?? '')
    )
  return true
}

const round = (element: Element) => element instanceof SVGCircleElement || element instanceof SVGEllipseElement

const entityOf = (element: Element) => element.closest('[data-entity-id]')?.getAttribute('data-entity-id') ?? undefined

function paintOf(painted: Painted, paint: Paint): AccentPaint {
  const entity = entityOf(painted.element)
  return {element: describe(painted.element), family: paint.family, property: paint.property, ...(entity === undefined ? {} : {entity})}
}

/**
 * Whether `inner` lies inside `outer`'s shape: its box, or for a circle or ellipse, the ellipse in its box (a round
 * `inner` by its own circle, so one packed against the edge still counts).
 */
function inside(inner: DOMRect, outer: DOMRect, round: boolean, innerRound: boolean): boolean {
  // A horizontal or vertical line has a box of no height or width.
  if (!(inner.width > 0 || inner.height > 0)) return false
  if (round && innerRound) {
    const distance = Math.hypot(
      inner.left + inner.width / 2 - (outer.left + outer.width / 2),
      inner.top + inner.height / 2 - (outer.top + outer.height / 2),
    )
    return distance + Math.max(inner.width, inner.height) / 2 <= Math.min(outer.width, outer.height) / 2 + 0.5
  }
  if (!round)
    return (
      inner.left >= outer.left - 0.5 &&
      inner.top >= outer.top - 0.5 &&
      inner.right <= outer.right + 0.5 &&
      inner.bottom <= outer.bottom + 0.5
    )
  const [cx, cy, rx, ry] = [outer.left + outer.width / 2, outer.top + outer.height / 2, outer.width / 2 + 0.5, outer.height / 2 + 0.5]
  return [
    [inner.left, inner.top],
    [inner.right, inner.top],
    [inner.left, inner.bottom],
    [inner.right, inner.bottom],
  ].every(([x, y]) => ((x! - cx) / rx) ** 2 + ((y! - cy) / ry) ** 2 <= 1)
}

/**
 * Every change or accent color drawn inside another: an HTML element whose background or border is a change hue
 * (added, removed, modified, moved) or the accent, with a descendant painting one; or an SVG shape filled or outlined
 * in one, with an element painted over it, inside its shape, that paints one. A categorical part's fill or background
 * (`data-projections-category`), focus and selection rings (outlines) and host chrome aren't accents here.
 */
export function nestedAccents(root: Element = document.body): NestedAccent[] {
  const hues = familyHues()
  const painted: Painted[] = []
  let order = 0
  const walk = (element: Element) => {
    if (
      element.hasAttribute('data-projections-host-overlay') ||
      ['SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'defs', 'DEFS', 'title', 'desc', 'mask', 'clipPath', 'marker', 'pattern'].includes(
        element.tagName,
      )
    )
      return
    const style = getComputedStyle(element)
    if (style.display === 'none') return
    if (visible(element) && !visuallyHidden(element, style)) {
      // A categorical part's fill or background is the category palette's, not an accent; the rest of it still counts.
      const paints = paintsOf(element, style, hues).filter(
        paint =>
          !(element.hasAttribute('data-projections-category') && (paint.property === 'fill' || paint.property === 'background-color')),
      )
      if (paints.length) {
        const svg = element instanceof SVGElement
        const surface = paints.find(paint =>
          svg ? svgSurface(element, style) && (paint.property === 'fill' || paint.property === 'stroke') : paint.property !== 'color',
        )
        painted.push({element, order: order++, surface, paints, box: element.getBoundingClientRect()})
      }
    }
    for (const child of element.children) walk(child)
  }
  for (const child of root.children) walk(child)
  const nested: NestedAccent[] = []
  for (const outer of painted) {
    if (!outer.surface) continue
    const svgRoot = outer.element instanceof SVGElement ? outer.element.ownerSVGElement : null
    for (const inner of painted) {
      if (inner === outer) continue
      const contained = svgRoot
        ? inner.order > outer.order &&
          svgRoot.contains(inner.element) &&
          inside(inner.box, outer.box, round(outer.element), round(inner.element))
        : outer.element.contains(inner.element)
      if (!contained) continue
      for (const paint of inner.paints) nested.push({outer: paintOf(outer, outer.surface), inner: paintOf(inner, paint)})
    }
  }
  return nested
}
