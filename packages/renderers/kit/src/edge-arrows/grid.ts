// The cheapest orthogonal course around cards, on the grid their edges make.
import {arrowHeadReach} from '../arrowhead.js'
import type {ArrowBox, Point} from '../edge-arrows.js'
import {clearance, crossesBox} from './boxes.js'

export function routeAroundCards(
  start: Point,
  end: Point,
  startDirection: Point,
  endDirection: Point,
  boxes: ArrowBox[],
): Point[] | undefined {
  const departure = {x: start.x + startDirection.x * 14, y: start.y + startDirection.y * 14}
  // Far enough out that the last corner's curve ends before the arrowhead's straight lead-in begins.
  const arrival = {x: end.x + endDirection.x * arrowHeadReach * 2, y: end.y + endDirection.y * arrowHeadReach * 2}
  const xs = [...new Set([departure.x, arrival.x, ...boxes.flatMap(box => [box.x - clearance, box.x + box.width + clearance])])].toSorted(
    (a, b) => a - b,
  )
  const ys = [...new Set([departure.y, arrival.y, ...boxes.flatMap(box => [box.y - clearance, box.y + box.height + clearance])])].toSorted(
    (a, b) => a - b,
  )
  const point = (x: number, y: number): Point => ({x: xs[x]!, y: ys[y]!})
  const startX = xs.indexOf(departure.x),
    startY = ys.indexOf(departure.y)
  const endX = xs.indexOf(arrival.x),
    endY = ys.indexOf(arrival.y)
  const initialDirection = startDirection.x ? (startDirection.x > 0 ? 0 : 2) : startDirection.y > 0 ? 1 : 3
  const finalDirection = endDirection.x ? (endDirection.x > 0 ? 2 : 0) : endDirection.y > 0 ? 3 : 1
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const
  const key = (x: number, y: number, direction: number) => `${x}:${y}:${direction}`
  const previous = new Map<string, string>()
  const costs = new Map([[key(startX, startY, initialDirection), 0]])
  const frontier = [{x: startX, y: startY, direction: initialDirection, cost: 0}]
  let finished: string | undefined
  while (frontier.length) {
    frontier.sort((a, b) => b.cost - a.cost)
    const current = frontier.pop()!
    const currentKey = key(current.x, current.y, current.direction)
    if (current.cost !== costs.get(currentKey)) continue
    if (current.x === endX && current.y === endY && current.direction === finalDirection) {
      finished = currentKey
      break
    }
    for (let direction = 0; direction < directions.length; direction++) {
      const [dx, dy] = directions[direction]!
      const x = current.x + dx,
        y = current.y + dy
      if (x < 0 || x >= xs.length || y < 0 || y >= ys.length) continue
      const from = point(current.x, current.y),
        to = point(x, y)
      if (boxes.some(box => crossesBox(from, to, box))) continue
      const nextKey = key(x, y, direction)
      const cost = current.cost + Math.abs(to.x - from.x) + Math.abs(to.y - from.y) + (direction === current.direction ? 0 : 28)
      if (cost >= (costs.get(nextKey) ?? Infinity)) continue
      costs.set(nextKey, cost)
      previous.set(nextKey, currentKey)
      frontier.push({x, y, direction, cost})
    }
  }
  if (!finished) return undefined
  const route: Point[] = []
  for (let current: string | undefined = finished; current; current = previous.get(current)) {
    const [x, y] = current.split(':').map(Number)
    route.push(point(x!, y!))
  }
  route.reverse()
  return [start, ...route, end]
}
