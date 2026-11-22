import {test} from 'node:test'
import assert from 'node:assert/strict'
import {concurrentLoads, loadNested, paintTimeoutMs} from '../node_modules/.cache/test/stage.js'

const noop = () => undefined

const extraction = {protocolVersion: 0, schema: 'graph/v0', entities: [], relationships: []}
const scenario = {renderer: 'graph', subject: {mode: 'extraction', extraction}}
const present = () => ({init: {mode: 'extraction', extraction, projection: {id: 's', title: 'S', renderer: 'graph'}}})
const tick = () =>
  new Promise(resolve => {
    setImmediate(resolve)
  })

/** A window whose timers run on demand, and containers whose frames can speak to it as their renderers would. */
function host() {
  const listeners = new Set()
  const timers = new Map()
  let next = 1
  const view = {
    crypto: {getRandomValues: bytes => bytes.fill(7)},
    setTimeout: (callback, ms) => {
      timers.set(next, {callback, ms})
      return next++
    },
    clearTimeout: id => timers.delete(id),
    addEventListener: (type, listener) => listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
  }
  const requestDocument = async () => '<!doctype html><html><head></head><body></body></html>'
  const load = () => {
    const iframe = {dataset: {}, style: {}, srcdoc: '', setAttribute: noop, remove: noop, contentWindow: {postMessage: noop}}
    const container = {ownerDocument: {defaultView: view, createElement: () => iframe}, append: noop}
    const states = []
    const stop = loadNested(container, scenario, requestDocument, {
      present,
      label: () => 'S',
      colorMode: () => 'light',
      started: noop,
      animated: noop,
      select: noop,
      settled: state => states.push(state),
    })
    const say = message => {
      const channel = new URLSearchParams(/location\.hash="([^"]+)"/u.exec(iframe.srcdoc)[1]).get('channel')
      for (const listener of listeners) listener({source: iframe.contentWindow, data: {projections: 0, channel, ...message}})
    }
    return {iframe, states, stop, say, started: () => iframe.srcdoc !== ''}
  }
  const ready = {type: 'ready', capabilities: {changeHighlighting: 'none'}}
  const fire = ms => {
    for (const [id, timer] of timers) {
      if (timer.ms !== ms) continue
      timers.delete(id)
      timer.callback()
    }
  }
  return {load, ready, fire}
}

test("a nested renderer's error or missing first paint fails its card, frees its slot, and stays failed", async () => {
  const gallery = host()
  const cards = Array.from({length: concurrentLoads + 1}, () => gallery.load())
  await tick()
  await tick()
  assert.deepEqual(
    cards.map(card => card.started()),
    [...Array(concurrentLoads).fill(true), false],
    'the last waits for a slot',
  )
  for (const card of cards.slice(0, concurrentLoads)) card.say(gallery.ready)
  cards[0].say({type: 'error', message: 'Cannot draw this extraction'})
  cards[1].say({type: 'rendered', progress: 1})
  gallery.fire(paintTimeoutMs)
  assert.deepEqual(cards[0].states, [{status: 'failed', message: 'Cannot draw this extraction'}])
  assert.deepEqual(cards[1].states, [{status: 'ready'}])
  for (const card of cards.slice(2, concurrentLoads)) {
    assert.deepEqual(card.states, [{status: 'failed', message: 'The graph renderer did not draw this scenario'}])
  }
  cards[0].say({type: 'rendered', progress: 1})
  assert.equal(cards[0].states.length, 1, 'a later paint does not make a failed card drawn')
  await tick()
  assert.equal(cards[concurrentLoads].started(), true, 'failed cards free their slots')
  for (const card of cards) card.stop()
})
