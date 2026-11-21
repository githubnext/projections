// A renderer's paint acknowledgements belong to the document it was sent: the frame numbers each `init`, the renderer
// echoes the latest it received, and an acknowledgement of an earlier one is dropped.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {RendererFrame} from '../dist/frame.js'

/** A window, its frame's contentWindow, the messages the frame sent its renderer, and a way to answer as the renderer. */
function setup() {
  const listeners = new Set()
  const sent = []
  const contentWindow = {postMessage: data => sent.push(data)}
  const view = {
    location: {href: 'http://host.test/', origin: 'http://host.test'},
    crypto: globalThis.crypto,
    performance: globalThis.performance,
    btoa: globalThis.btoa,
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener: (type, listener) => type === 'message' && listeners.add(listener),
    removeEventListener: (type, listener) => listeners.delete(listener),
    getComputedStyle: () => ({}),
  }
  const iframe = {
    contentWindow,
    style: {},
    dataset: {},
    attributes: {},
    clientWidth: 800,
    clientHeight: 600,
    isConnected: true,
    setAttribute(name, value) {
      this.attributes[name] = value
    },
    getAttribute(name) {
      return this.attributes[name] ?? null
    },
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({width: 800, height: 600, left: 0, top: 0}),
    remove() {},
  }
  const container = {ownerDocument: {createElement: () => iframe, defaultView: view}, append() {}}
  const events = []
  const document = {protocolVersion: 0, schema: 'graph/v0', entities: [], relationships: []}
  const init = generation => ({
    projection: {id: 'p', title: 'P', renderer: 'graph'},
    mode: 'extraction',
    extraction: {...document, generation},
    theme: {colorMode: 'light', tokens: {}},
    reducedMotion: false,
    locale: 'en',
  })
  const frame = new RendererFrame({
    container,
    url: '/graph/index.html',
    title: 'Graph',
    init: init(1),
    onEvent: event => events.push(event),
    window: view,
  })
  const channel = new URLSearchParams(new URL(iframe.src ?? frame.iframe.src ?? iframe.attributes.src).hash.slice(1)).get('channel')
  const answer = message => {
    for (const listener of [...listeners]) listener({data: {projections: 0, channel, ...message}, source: contentWindow, origin: 'null'})
  }
  return {frame, events, sent, answer, init}
}

const inits = sent => sent.filter(message => message.type === 'init')

test("a frame numbers each init, and drops a renderer's acknowledgement of an earlier one", () => {
  const {frame, events, sent, answer, init} = setup()
  answer({type: 'ready', capabilities: {changeHighlighting: 'supported'}})
  assert.equal(inits(sent).at(-1).generation, 0)
  frame.setInit(init(2))
  assert.equal(inits(sent).at(-1).generation, 1)
  // Sent before the renderer received the new init.
  answer({type: 'rendered', progress: 1, generation: 0})
  assert.equal(frame.renderedProgress, undefined)
  assert.equal(events.filter(event => event.type === 'rendered').length, 0)
  answer({type: 'rendered', progress: 1, generation: 1})
  assert.equal(frame.renderedProgress, 1)
  assert.deepEqual(
    events.filter(event => event.type === 'rendered'),
    [{type: 'rendered', progress: 1}],
  )
})

test('a renderer that echoes no generation is taken at its word, as before', () => {
  const {frame, answer, init} = setup()
  answer({type: 'ready', capabilities: {changeHighlighting: 'supported'}})
  frame.setInit(init(2))
  answer({type: 'rendered', progress: 0.5})
  assert.equal(frame.renderedProgress, 0.5)
})
