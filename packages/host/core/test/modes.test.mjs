import {test} from 'node:test'
import assert from 'node:assert/strict'
import {comparisonModes, connectorBetween, connectorPath} from '../dist/index.js'

const frame = (left, top, width, height) => ({
  clientLeft: 1,
  clientTop: 1,
  clientWidth: width - 2,
  clientHeight: height - 2,
  getBoundingClientRect: () => ({left, top, right: left + width, bottom: top + height, width, height}),
})
const origin = {left: 10, top: 20}

test('comparison modes are diff, side by side, animated and swipe, in that order', () => {
  assert.deepEqual(
    comparisonModes.map(mode => mode.value),
    ['diff', 'side-by-side', 'animated', 'swipe'],
  )
})

test('a horizontal connector runs from the right of the before anchor to the left of the after anchor', () => {
  const connector = connectorBetween(
    frame(10, 20, 400, 300),
    frame(430, 20, 400, 300),
    {x: 100, y: 50, width: 80, height: 40},
    {x: 30, y: 60, width: 80, height: 40},
    origin,
  )
  assert.deepEqual(connector, {x1: 181, y1: 71, x2: 451, y2: 81, vertical: false})
  assert.equal(connectorPath(connector), 'M 181 71 C 316 71, 316 81, 451 81')
})

test('stacked panes get a connector that leaves both anchors to the left and runs down the gutter', () => {
  const connector = connectorBetween(
    frame(28, 20, 400, 300),
    frame(28, 350, 400, 300),
    {x: 100, y: 50, width: 80, height: 40},
    {x: 60, y: 10, width: 80, height: 40},
    origin,
  )
  assert.deepEqual(connector, {x1: 119, y1: 71, x2: 79, y2: 361, vertical: true, gutter: 8})
  assert.equal(connectorPath(connector), 'M 119 71 H 16 Q 8 71 8 79 V 353 Q 8 361 16 361 H 79')
})

test('an anchor outside its frame hides the connector', () => {
  assert.equal(
    connectorBetween(
      frame(10, 20, 400, 300),
      frame(430, 20, 400, 300),
      {x: 500, y: 50, width: 80, height: 40},
      {x: 30, y: 60, width: 80, height: 40},
      origin,
    ),
    undefined,
  )
})

test('a chosen comparison mode is kept only when the renderer supports it', async () => {
  const {clampMode, defaultComparisonModes, twoPaneMode} = await import('../dist/index.js')
  assert.deepEqual(defaultComparisonModes, ['side-by-side', 'animated', 'swipe'])
  assert.equal(clampMode('swipe', defaultComparisonModes), 'swipe')
  assert.equal(clampMode(undefined, ['side-by-side', 'animated']), 'side-by-side')
  assert.equal(clampMode('animated', ['diff']), 'diff')
  assert.equal(clampMode('diff', defaultComparisonModes), 'side-by-side')
  assert.equal(clampMode('diff', []), 'side-by-side')
  assert.equal(twoPaneMode('swipe'), true)
  assert.equal(twoPaneMode('diff'), false)
})

test('modes show in canonical order and default to diff when supported, else side by side', async () => {
  const {defaultComparisonMode, orderComparisonModes, clampMode} = await import('../dist/index.js')
  assert.deepEqual(orderComparisonModes(['diff', 'swipe', 'animated', 'side-by-side']), ['diff', 'side-by-side', 'animated', 'swipe'])
  assert.equal(defaultComparisonMode(['animated', 'side-by-side', 'swipe']), 'side-by-side')
  assert.equal(defaultComparisonMode(['diff', 'side-by-side']), 'diff')
  assert.equal(defaultComparisonMode(['diff', 'animated']), 'diff')
  assert.equal(defaultComparisonMode(['diff']), 'diff')
  assert.equal(defaultComparisonMode([]), 'side-by-side')
  // A chosen mode the renderer supports is kept.
  assert.equal(clampMode('swipe', ['animated', 'side-by-side', 'swipe']), 'swipe')
  assert.equal(clampMode(undefined, ['animated', 'side-by-side']), 'side-by-side')
})
