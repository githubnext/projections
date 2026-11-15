// Vector helpers and the along/across frame of a route's axis.
import type {Point} from '../edge-arrows.js'

export const add = (a: Point, b: Point, scale = 1): Point => ({x: a.x + b.x * scale, y: a.y + b.y * scale})
export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y

/** Along-axis and across-axis coordinates of a point. */
export function frame(axis: Point) {
  const side = {x: -axis.y, y: axis.x}
  return {
    along: (point: Point) => dot(point, axis),
    across: (point: Point) => dot(point, side),
    point: (along: number, across: number): Point => add({x: axis.x * along, y: axis.y * along}, side, across),
  }
}
