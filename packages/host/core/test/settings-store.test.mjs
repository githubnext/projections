import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createSettingsStore, initialSettings, restartedSettings} from '../dist/projection/settings-store.js'

const extraction = {mode: 'extraction', extraction: {entities: [], relationships: []}}
const comparison = steps => ({mode: 'comparison', comparison: {steps: Array.from({length: steps}, () => ({}))}})
const options = overrides => ({subject: extraction, projection: {id: 'p', title: 'P'}, ...overrides})

test('settings start from the initial options, then the definition, then the shared defaults', () => {
  const plain = initialSettings(options())
  assert.equal(plain.changesOnly, true)
  assert.equal(plain.highlighting, 'animated')
  assert.equal(plain.loop, true)
  assert.equal(plain.position, 1)
  const seeded = initialSettings(options({presentation: {changesOnly: false, highlighting: 'on', mode: 'diff'}, initialLoop: false}))
  assert.equal(seeded.changesOnly, false)
  assert.equal(seeded.highlighting, 'on')
  assert.equal(seeded.mode, 'diff')
  assert.equal(seeded.loop, false)
  assert.equal(initialSettings(options({initialSpeed: 40})).speed, 10)
  assert.equal(initialSettings(options({subject: comparison(2), initialProgress: 0})).position, 0)
})

test('an uncontrolled setting keeps a requested change, notifies, and tells subscribers once', () => {
  const heard = []
  const store = createSettingsStore(options({onSearchChange: value => heard.push(value)}))
  let changes = 0
  const stop = store.subscribe(() => changes++)
  store.request('search', 'pay')
  assert.equal(store.value('search'), 'pay')
  assert.deepEqual(heard, ['pay'])
  assert.equal(changes, 1)
  store.request('search', 'pay')
  assert.equal(changes, 1, 'the same value is no change')
  assert.deepEqual(heard, ['pay', 'pay'], 'the embedder still hears every request')
  stop()
  store.request('search', '')
  assert.equal(changes, 1)
})

test('a controlled setting reads the embedder’s value and only requests a change, which a refusal discards', () => {
  const heard = []
  const store = createSettingsStore(options({loop: true, onLoopChange: value => heard.push(value)}))
  const before = store.getSnapshot()
  store.request('loop', false)
  assert.equal(store.value('loop'), true)
  assert.deepEqual(heard, [false])
  assert.equal(store.getSnapshot(), before, 'nothing changes while controlled')
  // The embedder stops controlling it without accepting the change: the refused value doesn't surface.
  store.update(options({onLoopChange: value => heard.push(value)}))
  assert.equal(store.value('loop'), true)
})

test('a new subject restarts playback, the slider and the selection, and keeps the rest', () => {
  const store = createSettingsStore(options({subject: comparison(2)}))
  store.request('playing', true)
  store.request('selectedId', 'a')
  store.request('search', 'pay')
  const next = options({subject: comparison(3), initialProgress: 0})
  store.update(next)
  store.set(settings => restartedSettings(settings, next, progress => progress))
  assert.equal(store.value('playing'), false)
  assert.equal(store.value('selectedId'), null)
  assert.equal(store.value('position'), 0)
  assert.equal(store.value('search'), 'pay')
})
