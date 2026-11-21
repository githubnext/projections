import {test} from 'node:test'
import assert from 'node:assert/strict'
import {NoRouteError, boxEdge, routeBoxEdge} from '../dist/index.js'

const source = {x: 0, y: 0, width: 100, height: 40}
const target = {x: 0, y: 300, width: 100, height: 40}
// A closed ring of cards around the target: no route reaches it without crossing one.
const ring = [
  {x: -60, y: 250, width: 220, height: 30},
  {x: -60, y: 280, width: 30, height: 100},
  {x: 130, y: 280, width: 30, height: 100},
  {x: -60, y: 360, width: 220, height: 30},
]

test('with no route around the cards, routeBoxEdge returns the least-overlapping one and the cards it crosses', () => {
  const routed = routeBoxEdge(source, target, ring)
  assert.equal(routed.blocked, true)
  // The direct way in crosses only the ring's top; going round to a side would cross that and a wall.
  assert.deepEqual(routed.crossed, [0])
  assert.match(routed.least.d, /^M/)
  assert.throws(
    () => boxEdge(source, target, ring),
    error => error instanceof NoRouteError && error.blocked.crossed.length === 1,
  )
  // A way around is still a route, not a blocked one.
  assert.equal('blocked' in routeBoxEdge(source, target, [ring[1]]), false)
})

test('boxes that cannot be joined at all throw loudly instead of looking blocked', () => {
  assert.throws(() => routeBoxEdge(source, {...target, x: Number.NaN}, ring), RangeError)
})
