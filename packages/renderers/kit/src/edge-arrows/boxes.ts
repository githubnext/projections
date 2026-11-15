// Card boxes as obstacles: the clearance arrows keep from them.
import type {ArrowBox, Point} from '../edge-arrows.js'

export const clearance = 12

export function contains(box: ArrowBox, point: Point, pad = 0): boolean {
  return point.x > box.x - pad && point.x < box.x + box.width + pad && point.y > box.y - pad && point.y < box.y + box.height + pad
}

export function crossesBox(a: Point, b: Point, box: ArrowBox): boolean {
  if (a.x === b.x) {
    return (
      a.x > box.x - clearance &&
      a.x < box.x + box.width + clearance &&
      Math.max(a.y, b.y) > box.y - clearance &&
      Math.min(a.y, b.y) < box.y + box.height + clearance
    )
  }
  return (
    a.y > box.y - clearance &&
    a.y < box.y + box.height + clearance &&
    Math.max(a.x, b.x) > box.x - clearance &&
    Math.min(a.x, b.x) < box.x + box.width + clearance
  )
}

export function outward(box: ArrowBox, x: number, y: number): [number, number] {
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  return Math.abs(x - centerX) / box.width > Math.abs(y - centerY) / box.height ? [Math.sign(x - centerX), 0] : [0, Math.sign(y - centerY)]
}
