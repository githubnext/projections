import {test} from 'node:test'
import assert from 'node:assert/strict'
import {isPlaybackShortcut, playButton, rovingIndex} from '../dist/index.js'

// Just enough DOM for the shortcut's containment rules: `keeps` marks an element that uses Space itself.
class FakeElement {
  constructor(parent, keeps = false) {
    this.parentElement = parent
    this.keeps = keeps
  }
  contains(other) {
    for (let node = other; node; node = node.parentElement) if (node === this) return true
    return false
  }
  closest() {
    if (this.keeps) return this
    return this.parentElement?.closest() ?? null
  }
}
globalThis.Node = FakeElement
globalThis.Element = FakeElement

const space = (target, currentTarget, extra = {}) => ({
  key: ' ',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  target,
  currentTarget,
  ...extra,
})

test('Space on the listener or an element that leaves Space alone is the playback shortcut', () => {
  const toolbar = new FakeElement(null)
  const slider = new FakeElement(toolbar)
  assert.equal(isPlaybackShortcut(space(toolbar, toolbar)), true)
  assert.equal(isPlaybackShortcut(space(slider, toolbar)), true)
  assert.equal(isPlaybackShortcut(space(slider, toolbar, {shiftKey: true})), false)
  assert.equal(isPlaybackShortcut(space(slider, toolbar, {defaultPrevented: true})), false)
  assert.equal(isPlaybackShortcut({...space(slider, toolbar), key: 'Enter'}), false)
})

test('Space stays with fields and controls that use it, unless one encloses the listener', () => {
  const dialog = new FakeElement(null, true)
  const toolbar = new FakeElement(dialog)
  const button = new FakeElement(toolbar, true)
  assert.equal(isPlaybackShortcut(space(button, toolbar)), false)
  assert.equal(isPlaybackShortcut(space(toolbar, toolbar)), true)
  const portaled = new FakeElement(null)
  assert.equal(isPlaybackShortcut(space(portaled, toolbar)), false)
})

test('roving choice wraps, keeps to its axis, and ignores other keys', () => {
  assert.equal(rovingIndex('ArrowRight', 2, 3), 0)
  assert.equal(rovingIndex('ArrowUp', 0, 3), 2)
  assert.equal(rovingIndex('ArrowDown', 0, 3, 'horizontal'), undefined)
  assert.equal(rovingIndex('ArrowLeft', 1, 3, 'vertical'), undefined)
  assert.equal(rovingIndex('End', 0, 3), 2)
  assert.equal(rovingIndex('Home', 2, 3), 0)
  assert.equal(rovingIndex('a', 1, 3), undefined)
  assert.equal(rovingIndex('ArrowRight', 0, 0), undefined)
})

test('the play button pauses while playing, plays in its direction, and shows an endpoint under reduced motion', () => {
  const p = (playing, nextDirection, reducedMotion = false) => ({playing, nextDirection, reducedMotion})
  assert.deepEqual(playButton(p(true, 1), 'main', 'head'), {action: 'pause', direction: 1, label: 'Pause'})
  assert.equal(playButton(p(false, -1), 'main', 'head').label, 'Play backward')
  assert.deepEqual(playButton(p(false, 1, true), 'main', 'head'), {action: 'show', direction: 1, label: 'Show head'})
})
