// A ring's units and their SVG shapes, and the styling that draws an edge or a ring.
import {colorAlpha} from '../paint.js'
import {spreads, type EdgeInfo} from './edges.js'

export type RingState = 'hover' | 'selected' | 'focus'
/** The unit an entity element belongs to: the nearest marked unit around it, else the outermost entity element. */
export function ringUnitOf(element: Element): Element {
  let unit = element
  for (let cursor: Element | null = element; cursor; cursor = cursor.parentElement?.closest('[data-entity-id]') ?? null) {
    if (cursor.hasAttribute('data-projections-unit')) return cursor
    unit = cursor
  }
  return unit
}
export function ringUnits(id: string): Element[] {
  const elements = [...document.querySelectorAll('[data-entity-id]')].filter(element => element.getAttribute('data-entity-id') === id)
  return [...new Set(elements.map(ringUnitOf))]
}
export const isSvg = (element: Element) => element instanceof SVGElement && !(element instanceof SVGSVGElement)
export const format = (value: number) => `${Math.round(value * 100) / 100} px`

/** The SVG shapes of a unit, and the pieces drawn for it elsewhere. */
export function svgShapes(unit: Element): SVGGeometryElement[] {
  const id = unit.getAttribute('data-entity-id')
  const pieces =
    id === null
      ? []
      : [...document.querySelectorAll('[data-projections-ring-with]')].filter(
          piece => piece.getAttribute('data-projections-ring-with') === id,
        )
  return [unit, ...pieces]
    .flatMap(root => [root, ...root.querySelectorAll('rect, circle, ellipse, polygon, polyline, path, line')])
    .filter(
      (shape): shape is SVGGeometryElement =>
        shape instanceof SVGGeometryElement && !shape.closest('defs, clipPath, mask, marker, pattern'),
    )
}
export const markedEdges = (unit: Element) => svgShapes(unit).filter(shape => shape.hasAttribute('data-projections-edge'))
/** The shape that draws an SVG unit's edge: its largest painted closed shape, or null when it has none. */
export function largestClosedShape(unit: Element): SVGGeometryElement | null {
  const unitBox = unit.getBoundingClientRect()
  let best: SVGGeometryElement | null = null,
    bestArea = 0
  for (const shape of svgShapes(unit)) {
    if (!unit.contains(shape)) continue
    const style = getComputedStyle(shape)
    const closed =
      ['rect', 'circle', 'ellipse', 'polygon'].includes(shape.localName) || (shape.localName === 'path' && style.fill !== 'none')
    const painted = (style.fill !== 'none' && colorAlpha(style.fill) > 0.01) || (style.stroke !== 'none' && colorAlpha(style.stroke) > 0.01)
    if (!closed || !painted) continue
    const box = shape.getBoundingClientRect()
    const area = box.width * box.height
    if (area >= unitBox.width * unitBox.height * 0.6 && area >= bestArea) {
      best = shape
      bestArea = area
    }
  }
  return best
}

/** The ring an element's computed style shows, if any: an outline on HTML, a stroke on SVG. */
export function paintSignature(element: Element): string {
  const style = getComputedStyle(element)
  return isSvg(element)
    ? `${style.stroke} ${style.strokeWidth} ${style.strokeDasharray} ${style.fill}`
    : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} ${style.outlineOffset}`
}

export interface Neutral {
  units: Map<Element, {edge: EdgeInfo; ring: string}>
  edges: Map<Element, string>
  /** Everything else in the units that draws an edge: outline, ring-shaped shadow, border or stroke. */
  others: Map<Element, string>
}
export function otherEdges(units: Element[]): Map<Element, string> {
  const signatures = new Map<Element, string>()
  for (const unit of units) {
    const skip = new Set<Element>([unit, ...markedEdges(unit)])
    for (const element of [...unit.querySelectorAll('*')].slice(0, 400)) {
      if (skip.has(element)) continue
      let signature = ''
      for (const pseudo of [null, '::before', '::after'] as const) {
        const style = getComputedStyle(element, pseudo)
        if (pseudo && (style.content === 'none' || style.content === 'normal')) continue
        const outline =
          style.outlineStyle !== 'none' && colorAlpha(style.outlineColor) > 0.01 ? `${style.outlineWidth} ${style.outlineColor}` : ''
        const shadow = spreads(style.boxShadow)
        signature += `${outline}|${shadow.outer},${shadow.inner}|${style.stroke} ${style.strokeWidth}|`
      }
      signatures.set(element, signature)
    }
  }
  return signatures
}
