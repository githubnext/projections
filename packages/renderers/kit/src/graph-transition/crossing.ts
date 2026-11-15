// Routes a move redraws rather than morphs.
import type {Point} from '../edge-arrows.js'
import type {GraphLayout} from '../layout.js'
import {inflections, largestTurn} from '../routes/turns.js'
import {sampleSpline} from '../splines.js'
import {directRoute, interpolate, morphRoute, smoothJoins} from './morph.js'
import {largestKink, longestDiagonal} from './quality.js'

/**
 * Routes that would pass through a card if their control points were
 * interpolated from one layout to the next, because they go round a card on
 * the other side or take another layer. They are redrawn instead of morphed.
 * Samples the move symmetrically, so a transition and its mirror agree.
 */
export function crossingMorphs(
  before: GraphLayout,
  after: GraphLayout,
  ends: ReadonlyMap<string, {from: string; to: string}>,
  axis: Point,
): Set<string> {
  const redraw = new Set<string>()
  if (before === after) return redraw
  const cards = [...before.points.keys()].filter(id => after.points.has(id) && !before.groups.has(id) && !after.groups.has(id))
  const mixes = Array.from({length: 9}, (_, index) => (index + 1) / 10)
  const fine = Array.from({length: 39}, (_, index) => (index + 1) / 40)
  const middle = (id: string, mix: number): Point => {
    const from = before.points.get(id) ?? after.points.get(id)!,
      to = after.points.get(id) ?? from
    return {x: interpolate(from.x, to.x, mix), y: interpolate(from.y, to.y, mix)}
  }
  const boxes = mixes.map(mix =>
    cards.map(id => {
      const a = before.points.get(id)!,
        b = after.points.get(id)!,
        size = after.sizes.get(id)!
      const x = interpolate(a.x, b.x, mix),
        y = interpolate(a.y, b.y, mix)
      return {
        id,
        left: x - size.width / 2 + 1,
        right: x + size.width / 2 - 1,
        top: y - size.height / 2 + 1,
        bottom: y + size.height / 2 - 1,
      }
    }),
  )
  for (const [key, a] of before.routes) {
    const b = after.routes.get(key),
      edge = ends.get(key)
    if (!b || !edge) continue
    const crosses = mixes.some((mix, index) => {
      const centre = (id: string) => {
        const from = before.points.get(id),
          to = after.points.get(id)
        return from && to ? {x: interpolate(from.x, to.x, mix), y: interpolate(from.y, to.y, mix)} : undefined
      }
      const source = centre(edge.from),
        target = centre(edge.to)
      const direct = source && target ? directRoute(key, before, after, mix, source, target, axis) : undefined
      const morphed = direct ?? smoothJoins(morphRoute(a, b, mix))
      const points = sampleSpline(morphed, 4)
      const xs = points.map(point => point.x),
        ys = points.map(point => point.y)
      const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      return boxes[index]!.some(
        box =>
          box.id !== edge.from &&
          box.id !== edge.to &&
          box.left < right &&
          box.right > left &&
          box.top < bottom &&
          box.bottom > top &&
          points.some(point => point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom),
      )
    })
    // A morph that wiggles (turns back and forth more than either end does), doubles back or slants a straight run
    // is redrawn instead.
    const wiggles = () => {
      const allowed = Math.max(inflections(a), inflections(b))
      const turning = Math.max(largestTurn(a), largestTurn(b)) + 5
      const slanted = Math.max(longestDiagonal(a), longestDiagonal(b)) + 12
      return fine.some(mix => {
        if (directRoute(key, before, after, mix, middle(edge.from, mix), middle(edge.to, mix), axis)) return false
        const morph = smoothJoins(morphRoute(a, b, mix))
        return inflections(morph) > allowed || largestTurn(morph) > turning || largestKink(morph) > 0.5 || longestDiagonal(morph) > slanted
      })
    }
    if (crosses || wiggles()) redraw.add(key)
  }
  return redraw
}
