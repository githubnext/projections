// A renderer frame that opens its renderer's document itself (frame/opened.ts) while its own document may still load
// or answer: only the frame's own document's loads count against it until the opened one is assigned, and a renderer
// that answers meanwhile keeps its document, its navigation check and its frame.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {FrameLifecycle} from '../dist/frame/lifecycle.js'
import {OpenedDocument} from '../dist/frame/opened.js'

const noop = () => undefined

/** A window whose timers never fire on their own. */
const view = {setTimeout: () => 1, clearTimeout: noop}

/** A frame showing `src`, whose `load` the test fires. */
class Frame extends EventTarget {
  src = 'http://127.0.0.1:1/T/renderers/graph/index.html'
  style = {}
  dataset = {}
  getAttribute(name) {
    return name === 'src' ? this.src : null
  }
  load() {
    this.dispatchEvent(new Event('load'))
  }
}

/** A frame, its lifecycle, the events it reported, and an opener the test settles. */
function setup() {
  const iframe = new Frame()
  const events = []
  const lifecycle = new FrameLifecycle(view, iframe, 10_000, event => events.push(event), noop)
  let settle
  const opened = new OpenedDocument(
    () =>
      new Promise((resolve, reject) => {
        settle = {resolve, reject}
      }),
  )
  const open = () => opened.open(iframe, new URL(`${iframe.src}#channel=c`), lifecycle)
  return {iframe, events, lifecycle, open, settle: () => settle}
}

const tick = () =>
  new Promise(resolve => {
    setTimeout(resolve)
  })

test("a load of the frame's own document while the opened one is fetched counts against it, not the opened one", async () => {
  const {iframe, lifecycle, open, settle} = setup()
  open()
  iframe.load()
  settle().resolve('blob:http://127.0.0.1:1/opened')
  await tick()
  assert.equal(iframe.src, 'blob:http://127.0.0.1:1/opened#channel=c')
  iframe.load()
  assert.equal(lifecycle.status, 'loading')
})

test('a renderer that answers while its document is reopened keeps its document and its navigation check', async () => {
  const {iframe, events, lifecycle, open, settle} = setup()
  iframe.load()
  open()
  assert.equal(lifecycle.ready(), true)
  settle().resolve('blob:http://127.0.0.1:1/opened')
  await tick()
  assert.equal(iframe.src, 'http://127.0.0.1:1/T/renderers/graph/index.html')
  iframe.load()
  assert.equal(lifecycle.status, 'failed')
  assert.match(events.at(-1).message, /navigated its frame/)
})

test("a document that can't be opened doesn't stop a renderer that answered meanwhile", async () => {
  const {lifecycle, open, settle} = setup()
  open()
  lifecycle.ready()
  settle().reject(new Error('unavailable'))
  await tick()
  assert.equal(lifecycle.status, 'ready')
})
