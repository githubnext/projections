import {test} from 'node:test'
import assert from 'node:assert/strict'
import {embedRenderer} from '../dist/client.js'

const environment = {theme: {colorMode: 'dark', tokens: {}}, reducedMotion: false, locale: 'en-US'}
const extraction = {protocolVersion: 0, schema: 'graph/v0', entities: [], relationships: []}
const init = {mode: 'extraction', extraction, projection: {id: 'platform', title: 'Platform', renderer: 'graph'}, ...environment}

/** A container, its window and a nesting renderer's client, as much as `embedRenderer` uses of them. */
function fixture(documents = {graph: '<!doctype html><html><head><title>Graph</title></head><body></body></html>'}) {
  const listeners = new Set()
  const timers = new Map()
  let nextTimer = 1
  const view = {
    crypto: {getRandomValues: bytes => bytes.fill(7)},
    setTimeout: callback => {
      timers.set(nextTimer, callback)
      return nextTimer++
    },
    clearTimeout: id => timers.delete(id),
    addEventListener: (type, listener) => type === 'message' && listeners.add(listener),
    removeEventListener: (type, listener) => type === 'message' && listeners.delete(listener),
  }
  const sent = []
  const contentWindow = {postMessage: (data, target) => sent.push({data, target})}
  const iframe = {
    attributes: {},
    clientWidth: 400,
    clientHeight: 318,
    dataset: {},
    style: {},
    contentWindow,
    srcdoc: '',
    removed: false,
    setAttribute(name, value) {
      this.attributes[name] = value
    },
    remove() {
      this.removed = true
    },
  }
  const ownerDocument = {defaultView: view, createElement: () => iframe}
  const appended = []
  const container = {ownerDocument, append: element => appended.push(element)}
  const requested = []
  const client = {
    requestDocument: async name => {
      requested.push(name)
      if (documents[name]) return documents[name]
      throw new Error(`${name} is not a built-in renderer`)
    },
  }
  const fromFrame = (message, source = contentWindow) => {
    const channel = new URLSearchParams(/location\.hash="([^"]+)"/u.exec(iframe.srcdoc)[1]).get('channel')
    for (const listener of listeners) listener({source, data: {projections: 0, channel, ...message}})
  }
  return {
    view,
    iframe,
    container,
    appended,
    client,
    requested,
    sent,
    fromFrame,
    listeners,
    expire: () => timers.forEach(callback => callback()),
  }
}

test('embedRenderer runs the host-supplied document in a sandboxed srcdoc frame and hosts it', async () => {
  const f = fixture()
  const messages = []
  const nested = embedRenderer(f.client, f.container, {
    renderer: 'graph',
    title: 'Platform, drawn by the graph renderer',
    init,
    progress: {progress: 1, highlighting: 1, direction: 1},
    onMessage: message => messages.push(message),
  })
  assert.deepEqual(f.appended, [f.iframe])
  assert.equal(f.iframe.attributes.sandbox, 'allow-scripts')
  assert.equal(f.iframe.attributes['aria-label'], 'Platform, drawn by the graph renderer')
  assert.equal(f.iframe.style.opacity, '0')
  await new Promise(setImmediate)
  assert.deepEqual(f.requested, ['graph'])
  // The fragment is set first thing in the head, before the renderer's own scripts connect.
  assert.match(
    f.iframe.srcdoc,
    /^<!doctype html><html><head><script>location\.hash="channel=[0-9a-f]{48}&origin=null&color=dark"<\/script><title>/u,
  )
  nested.select('a')
  assert.equal(f.sent.length, 0, 'nothing is sent before ready')
  // Messages from anywhere else, or that don't validate, are ignored.
  f.fromFrame({type: 'ready', capabilities: {changeHighlighting: 'supported'}}, {})
  f.fromFrame({type: 'ready', capabilities: {changeHighlighting: 'sometimes'}})
  assert.equal(f.sent.length, 0)
  f.fromFrame({type: 'ready', capabilities: {changeHighlighting: 'supported'}})
  assert.deepEqual(await nested.ready, {changeHighlighting: 'supported'})
  assert.deepEqual(
    f.sent.map(({data}) => data.type),
    ['init', 'viewport', 'select', 'progress'],
  )
  assert.equal(f.sent[0].data.sizing, 'fill')
  assert.ok(f.sent.every(({target}) => target === '*'))
  f.fromFrame({type: 'rendered', progress: 1})
  assert.equal(f.iframe.style.opacity, '')
  // A nested renderer may nest another: its request goes to this renderer's host.
  f.fromFrame({type: 'document-request', renderer: 'database'})
  await new Promise(setImmediate)
  assert.deepEqual(f.sent.at(-1).data, {
    projections: 0,
    channel: f.sent[0].data.channel,
    type: 'document',
    renderer: 'database',
    error: 'database is not a built-in renderer',
  })
  assert.deepEqual(
    messages.map(message => message.type),
    ['ready', 'rendered', 'document-request'],
  )
  nested.hover('a')
  assert.equal(f.sent.at(-1).data.type, 'document', 'hover only to renderers that declare it')
  nested.dispose()
  assert.ok(f.iframe.removed)
  assert.equal(f.listeners.size, 0)
})

test('embedRenderer reports a refused document as a failure', async () => {
  const f = fixture({})
  const failures = []
  const nested = embedRenderer(f.client, f.container, {renderer: 'mine', title: 'Mine', init, onFailure: message => failures.push(message)})
  await assert.rejects(nested.ready, /mine is not a built-in renderer/u)
  assert.deepEqual(failures, ['mine is not a built-in renderer'])
  assert.equal(f.iframe.srcdoc, '')
})

test("embedRenderer can choose what to present from the nested renderer's capabilities", async () => {
  const f = fixture()
  const seen = []
  const nested = embedRenderer(f.client, f.container, {
    renderer: 'graph',
    title: 'Platform',
    colorMode: 'light',
    init: capabilities => {
      seen.push(capabilities)
      return {...init, comparisonMode: capabilities.comparisonModes?.includes('diff') ? 'diff' : 'animated'}
    },
    progress: capabilities => (capabilities.comparisonModes?.includes('diff') ? undefined : {progress: 1, highlighting: 1, direction: 1}),
  })
  await new Promise(setImmediate)
  assert.match(f.iframe.srcdoc, /color=light/u)
  f.fromFrame({type: 'ready', capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff']}})
  await nested.ready
  assert.deepEqual(seen, [{changeHighlighting: 'supported', comparisonModes: ['diff']}])
  assert.deepEqual(
    f.sent.map(({data}) => [data.type, data.comparisonMode]),
    [
      ['init', 'diff'],
      ['viewport', undefined],
    ],
    'diff, and no progress',
  )
  nested.dispose()
})

test('the fragment script carries the nonce the host gave the document, so a nonce policy runs it', async () => {
  const {withFragment} = await import('../dist/embed.js')
  const fragment = 'channel=abcdefghijklmnop0123&origin=null'
  assert.equal(
    withFragment('<!doctype html><html><head><script nonce="n0nce+/=">run()</script></head></html>', fragment),
    `<!doctype html><html><head><script nonce="n0nce+/=">location.hash="${fragment}"</script><script nonce="n0nce+/=">run()</script></head></html>`,
  )
  assert.equal(withFragment('<p>no head</p>', fragment), `<script>location.hash="${fragment}"</script><p>no head</p>`)
  assert.equal(
    withFragment('<HEAD lang="en"><script type="module"></script><script nonce="abc">x</script><header>', fragment),
    `<HEAD lang="en"><script nonce="abc">location.hash="${fragment}"</script><script type="module"></script><script nonce="abc">x</script><header>`,
  )
  const hostile = '<head'.repeat(200_000)
  const started = performance.now()
  assert.equal(withFragment(hostile, fragment), `<script>location.hash="${fragment}"</script>${hostile}`)
  assert.ok(performance.now() - started < 1000, 'many unclosed <head tags stay linear')
})
