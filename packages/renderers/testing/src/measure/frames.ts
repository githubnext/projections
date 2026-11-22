// Rounded, edged boxes whose contents fill their corners: the edge must be drawn over them (probe call `frames`).
import type {CoveredFrame} from '../types.js'
import {cornerNames, cornerOverlaid, cornerPoint, cornerRadii, type Corner} from './frames/overlays.js'
import {colorAlpha, describe, px, visible} from './paint.js'

const transparent = (color: string) => colorAlpha(color) <= 0.01

/** Whether an element paints a surface: a background color or image, or replaced content (a renderer's frame, an image). */
const paints = (element: Element, style: CSSStyleDeclaration) =>
  !transparent(style.backgroundColor) || style.backgroundImage !== 'none' || element.matches('iframe, img, video, canvas, embed, object')

/**
 * Its edge: the width of its visible border (a transparent one draws nothing), or of an outline drawn inside its box,
 * and which; none when it has none.
 */
function edgeOf(style: CSSStyleDeclaration): {width: number; by: 'border' | 'outline'} | undefined {
  const sides = ['top', 'right', 'bottom', 'left'].filter(
    side => style.getPropertyValue(`border-${side}-style`) !== 'none' && !transparent(style.getPropertyValue(`border-${side}-color`)),
  )
  const border = Math.max(0, ...sides.map(side => px(style.getPropertyValue(`border-${side}-width`))))
  if (border > 0) return {width: border, by: 'border'}
  const outline =
    style.outlineStyle !== 'none' && !transparent(style.outlineColor) && px(style.outlineOffset) < 0 ? px(style.outlineWidth) : 0
  return outline > 0 ? {width: outline, by: 'outline'} : undefined
}

/**
 * The sides a box's inset shadows draw a sharp, visible edge along: offset toward a side, or spread all round (as a data
 * table's first cell draws the table's left edge).
 */
function shadowSides(style: CSSStyleDeclaration): Set<string> {
  const sides = new Set<string>()
  for (const shadow of style.boxShadow === 'none' ? [] : style.boxShadow.split(/,(?![^(]*\))/u)) {
    if (!/\binset\b/u.test(shadow)) continue
    const color = /(?:rgba?|color|hsla?|oklch|oklab|lab|lch)\([^)]*\)|transparent/u.exec(shadow)?.[0] ?? 'currentColor'
    if (color !== 'currentColor' && transparent(color)) continue
    const [x = 0, y = 0, blur = 0, spread = 0] = shadow
      .replace(color, '')
      .split(/\s+/u)
      .filter(part => /^-?[\d.]+px$/u.test(part))
      .map(px)
    if (blur > 0.01) continue
    if (x > 0.01 || spread > 0.01) sides.add('left')
    if (x < -0.01 || spread > 0.01) sides.add('right')
    if (y > 0.01 || spread > 0.01) sides.add('top')
    if (y < -0.01 || spread > 0.01) sides.add('bottom')
  }
  return sides
}

/**
 * Whether a fill draws an edge itself, on the sides of `corner`: a visible border, or a sharp, visible inset shadow
 * along one. Such a box is the edge there, as a data table's rows are its frame, not a fill painted over it.
 */
function drawsEdge(style: CSSStyleDeclaration, corner: Corner): boolean {
  const sides = [corner.startsWith('top') ? 'top' : 'bottom', corner.endsWith('left') ? 'left' : 'right']
  const shadowed = shadowSides(style)
  return sides.some(
    side =>
      shadowed.has(side) ||
      (style.getPropertyValue(`border-${side}-style`) !== 'none' &&
        px(style.getPropertyValue(`border-${side}-width`)) > 0 &&
        !transparent(style.getPropertyValue(`border-${side}-color`))),
  )
}

/** Whether a descendant paints under its frame's outline: outside any positioned layer, or below the frame's paint. */
function underOutline(fill: Element, frame: Element, frameStyle: CSSStyleDeclaration): boolean {
  for (let element: Element | null = fill; element && element !== frame; element = element.parentElement) {
    const style = getComputedStyle(element)
    if (style.position === 'static') continue
    // Positioned: over the outline unless in a layer below the frame's own paint.
    return (Number.parseInt(style.zIndex, 10) || 0) < 0 && (frameStyle.isolation === 'isolate' || frameStyle.zIndex !== 'auto')
  }
  return true
}

/**
 * Every HTML box with rounded corners (larger than its edge) and an edge (a border, or an outline inside its box) whose
 * painted contents reach a corner, without its edge drawn over them: there, the fill's curve meets the edge's and
 * dilutes its antialiased pixels, so the arc comes out thinner than the sides, concentric or not. A box draws its edge
 * over its contents with the kit's frame (`pk-frame`, or a `Group`), or as an outline its contents sit under.
 */
export function coveredFrames(root: Element = document.body): CoveredFrame[] {
  const found: CoveredFrame[] = []
  for (const element of root.querySelectorAll('*')) {
    if (element instanceof SVGElement || element.hasAttribute('data-projections-host-overlay') || !visible(element)) continue
    const style = getComputedStyle(element)
    const edge = edgeOf(style)
    if (!edge) continue
    const box = element.getBoundingClientRect()
    // Each corner's radius as drawn: the smaller of its two, fitted as CSS fits them.
    const radii = cornerRadii(element)
    if (Math.max(...radii.values()) <= edge.width) continue
    for (const fill of element.querySelectorAll('*')) {
      if (fill instanceof SVGElement || !visible(fill)) continue
      const fillStyle = getComputedStyle(fill)
      if (!paints(fill, fillStyle)) continue
      const inner = fill.getBoundingClientRect()
      // The corners its painted box reaches into, as far as the edge's inside, its edge not drawn over it there.
      const reached = cornerNames.filter(corner => {
        const {x, y} = cornerPoint(box, corner)
        return (
          (radii.get(corner) ?? 0) > edge.width &&
          Math.abs((corner.endsWith('left') ? inner.left : inner.right) - x) <= edge.width + 0.5 &&
          Math.abs((corner.startsWith('top') ? inner.top : inner.bottom) - y) <= edge.width + 0.5 &&
          !(edge.by === 'border' && cornerOverlaid(element, corner, edge.width, fill)) &&
          !drawsEdge(fillStyle, corner)
        )
      })
      if (!reached.length) continue
      if (edge.by === 'outline' && underOutline(fill, element, style)) continue
      found.push({element: describe(element), fill: describe(fill)})
      break
    }
  }
  return found
}
