import {test} from 'node:test'
import assert from 'node:assert/strict'
import {routeLinks} from '../node_modules/.cache/test/card.js'

test('a link no route can take around the cards is drawn the way that crosses them least, naming what it crosses', () => {
  // The target stands inside a closed ring of other cards.
  const cards = new Map([
    ['source', {x: 0, y: 0, width: 100, height: 40}],
    ['target', {x: 0, y: 300, width: 100, height: 40}],
    ['top', {x: -60, y: 250, width: 220, height: 30}],
    ['left', {x: -60, y: 280, width: 30, height: 100}],
    ['right', {x: 130, y: 280, width: 30, height: 100}],
    ['bottom', {x: -60, y: 360, width: 220, height: 30}],
  ])
  const link = {key: 'l', id: 'l', fromId: 'source', toId: 'target', from: {x: 50, y: 40}, to: {x: 50, y: 300}}
  const route = routeLinks(cards, [link], 0.5).get('l')
  assert.deepEqual(route.crossing, ['top'])
  assert.match(route.d, /^M/u)
  // With the ring open on one side, the link goes around and crosses nothing.
  cards.delete('right')
  assert.equal(routeLinks(cards, [link], 0.5).get('l').crossing, undefined)
})
