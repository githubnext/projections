import {test} from 'node:test'
import assert from 'node:assert/strict'
import {coverTokens, insets} from '../dist/stage/cover.js'
import {glassSupported} from '../dist/ui/view/glass.js'

test("a frame's covers split at its middle: chips and the playback bar take its top, the floating foot its bottom", () => {
  const chip = {y: 12, height: 28}
  const foot = {y: 527, height: 61}
  // The chip's bottom and its 12px gap again; the foot's top up from the 600px frame's bottom, and its 12px gap.
  assert.deepEqual(insets([chip, foot], 600), {insetTop: 52, insetBottom: 85})
  assert.deepEqual(insets([foot], 600), {insetTop: 0, insetBottom: 85})
  assert.deepEqual(insets([chip], 600), {insetTop: 52, insetBottom: 0})
})

test('a cover sends an inset only for the edges something covers', () => {
  assert.deepEqual(coverTokens({cover: '200 527 600 61', insetTop: 0, insetBottom: 85}), {
    'stage-cover': '200 527 600 61',
    'stage-inset-bottom': '85px',
  })
  assert.deepEqual(coverTokens({cover: '12 12 180 28', insetTop: 52, insetBottom: 0}), {
    'stage-cover': '12 12 180 28',
    'stage-inset-top': '52px',
  })
})

test('glass is off in WebKit, every iOS browser included, and on in desktop Chromium', () => {
  globalThis.CSS ??= {supports: () => true}
  const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)'
  assert.equal(glassSupported(`${ios} Version/17.0 Mobile/15E148 Safari/604.1`), false)
  assert.equal(glassSupported(`${ios} CriOS/120.0 Mobile/15E148 Safari/604.1`), false)
  assert.equal(glassSupported(`${ios} EdgiOS/120.0 Mobile/15E148 Safari/605.1.15`), false)
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)'
  assert.equal(glassSupported(`${mac} Chrome/120.0 Safari/537.36`), true)
  assert.equal(glassSupported(`${mac} Chrome/120.0 Safari/537.36 Edg/120.0`), true)
})
