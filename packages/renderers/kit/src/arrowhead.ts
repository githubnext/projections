import type {Point} from './edge-arrows.js'

/**
 * The one arrowhead every kit renderer draws: an equilateral triangle with
 * slightly rounded corners. Its rounded tip touches the target exactly, and
 * the relationship's shaft ends at the middle of its flat base, so the stroke
 * never reaches the point. Every unit is in the drawing's own coordinates, so
 * heads scale with the graph's zoom like its strokes.
 */

/** From the rounded tip to the flat base, along the head's axis. */
export const arrowHeadLength = 8.5
/** Radius of the head's rounded corners. */
export const arrowHeadCornerRadius = 1.25
/** The straight run of shaft before the base, collinear with the head, that a route curves into. */
export const arrowHeadLeadIn = 6
/** Stroke width that rounds the inner outline's corners to `arrowHeadCornerRadius`. */
export const arrowHeadStrokeWidth = arrowHeadCornerRadius * 2
/** From the tip to where a route may stop being straight: head plus lead-in. */
export const arrowHeadReach = arrowHeadLength + arrowHeadLeadIn

/** One arrowhead's geometry, from `arrowHead`: where it touches, where its shaft ends, and its outline. */
export interface ArrowHead {
  /** Where the rounded tip touches the target. */
  tip: Point
  /** Unit vector from base to tip. */
  direction: Point
  /** Middle of the flat base, where the shaft ends. */
  base: Point
  /** Where the straight lead-in begins: the shaft runs straight from here to `base`. */
  lead: Point
  /**
   * The inner outline, drawn filled and stroked with `arrowHeadStrokeWidth`
   * and round joins (see `arrowHeadStyle`): the stroke rounds its corners and
   * grows it to the head's full size.
   */
  path: string
}

const format = (value: number) => Math.round(value * 100) / 100

/** The head at `tip`, pointing along `direction` (normalized here). */
export function arrowHead(tip: Point, direction: Point): ArrowHead {
  const length = Math.hypot(direction.x, direction.y) || 1
  const d = {x: direction.x / length, y: direction.y / length}
  const r = arrowHeadCornerRadius
  // A round join's outer edge is `r` beyond its vertex, so the inner tip sits `r` short of the visible one, and the
  // inner outline is the full equilateral triangle shrunk by `r` on every side (its height by `3r`).
  const height = arrowHeadLength + r - 3 * r
  const halfBase = height / Math.sqrt(3)
  const innerTip = {x: tip.x - d.x * r, y: tip.y - d.y * r}
  const innerBase = {x: innerTip.x - d.x * height, y: innerTip.y - d.y * height}
  const side = {x: -d.y * halfBase, y: d.x * halfBase}
  const at = (point: Point) => `${format(point.x)},${format(point.y)}`
  return {
    tip,
    direction: d,
    base: {x: tip.x - d.x * arrowHeadLength, y: tip.y - d.y * arrowHeadLength},
    lead: {x: tip.x - d.x * arrowHeadReach, y: tip.y - d.y * arrowHeadReach},
    path: `M${at(innerTip)} L${at({x: innerBase.x + side.x, y: innerBase.y + side.y})} L${at({x: innerBase.x - side.x, y: innerBase.y - side.y})}Z`,
  }
}

/** Presentation attributes for an arrowhead path: filled and stroked in `color`, with round joins. */
export function arrowHeadStyle(color: string): {fill: string; stroke: string; strokeWidth: number; strokeLinejoin: 'round'} {
  return {fill: color, stroke: color, strokeWidth: arrowHeadStrokeWidth, strokeLinejoin: 'round'}
}

/**
 * An equilateral arrowhead with rounded corners, pointing at (`x`, `y`) in
 * the direction `angle` (radians; 0 points right, −π/2 points up). Fill and
 * stroke it in one color with `stroke-linejoin: round` (the kit's
 * `.pk-arrowhead`); `size` is the side length.
 */
export function arrowheadPath(x: number, y: number, angle: number, size = 7): string {
  const height = (size * Math.sqrt(3)) / 2
  const back = {x: x - Math.cos(angle) * height, y: y - Math.sin(angle) * height}
  const half = size / 2
  const nx = -Math.sin(angle) * half,
    ny = Math.cos(angle) * half
  const round = (value: number) => Number(value.toFixed(2))
  return `M${round(x)},${round(y)} L${round(back.x + nx)},${round(back.y + ny)} L${round(back.x - nx)},${round(back.y - ny)} Z`
}

/** A document-unique marker ID for an arbitrary key, safe in `url(#…)`. */
export function edgeMarkerId(prefix: string, key: string): string {
  return `${prefix}-${Array.from(key, character => character.codePointAt(0)!.toString(16)).join('-')}`
}
