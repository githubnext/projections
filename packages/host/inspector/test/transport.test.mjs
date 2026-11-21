import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createInspectorClient} from '../dist/ui/client/create.js'
import {
  InspectorRequestError,
  createMessageTransport,
  including,
  isApiPath,
  parseTransportMessage,
  requestErrorMessage,
  transportTag,
} from '../dist/ui/transport.js'
import {externalUrl} from '../dist/ui/host.js'

const noop = () => undefined

test('API paths are server-relative /api/ paths without traversal, fragments or control characters', () => {
  for (const path of ['/api/definitions?ref=working-tree', '/api/jobs/abc/cancel', '/api/changes?since=3']) {
    assert.equal(isApiPath(path), true, path)
  }
  for (const path of [
    'http://127.0.0.1/api/x',
    '//evil.example/api/x',
    '/custom-renderers/x',
    '/api/../index.html',
    '/api/./x',
    '/api/x#y',
    '/api\\x',
    '/api/x\n',
    ''.padEnd(5000, 'a'),
    42,
  ]) {
    assert.equal(isApiPath(path), false, String(path))
  }
})

/** A bridge on the other side of a message channel, answering with `answer(path)`. */
function channel(answer) {
  const listeners = new Set()
  const posted = []
  const transport = createMessageTransport({
    origin: 'http://127.0.0.1:4000',
    post: message => {
      posted.push(message)
      const parsed = parseTransportMessage(message)
      if (parsed?.type !== 'request') return
      queueMicrotask(() => {
        const reply = answer(parsed)
        if (reply) for (const listener of listeners) listener({tag: transportTag, id: parsed.id, ...reply})
      })
    },
    listen: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })
  return {transport, posted}
}

test('the message transport carries requests to a bridge, and the client reads the runner through it', async () => {
  const {transport, posted} = channel(request =>
    request.path.startsWith('/api/revisions')
      ? {type: 'response', status: 200, body: {revisions: [{ref: 'working-tree', commit: '', title: 'Working tree'}]}}
      : request.path.startsWith('/api/changes')
        ? {type: 'response', status: 200, body: {generation: 2, complete: true, changes: ['working-tree']}}
        : {type: 'response', status: 403, body: 'Offline review has no repository history'},
  )
  const client = createInspectorClient({transport})
  assert.equal((await client.revisions(undefined, 5)).revisions[0].ref, 'working-tree')
  assert.deepEqual(await client.changes(1), {generation: 2, complete: true, changes: ['working-tree']})
  assert.equal(posted[0].path, '/api/revisions?limit=5')
  assert.equal(posted[1].path, '/api/changes?since=1')
  const refused = await client.definitions('working-tree').catch(error => error)
  assert.ok(refused instanceof InspectorRequestError)
  assert.equal(refused.status, 403)
  assert.equal(refused.message, 'The Projections runner refused the request (403): Offline review has no repository history')
})

test('refusals read as their diagnostics with where they are, never as raw JSON', () => {
  const body = {
    diagnostics: [
      {
        code: 'INVALID_DEFINITION',
        message: 'Module comparators were removed; name a comparator file instead.',
        path: '.github/projections/legacy.json',
        location: {path: '.github/projections/legacy.json', line: 7, column: 5},
      },
      {code: 'RUNNER_ERROR', message: 'comparator has unknown field module', path: '', severity: 'error'},
    ],
  }
  const expected =
    'Module comparators were removed; name a comparator file instead. (.github/projections/legacy.json:7:5)\ncomparator has unknown field module'
  assert.equal(requestErrorMessage(400, body), expected)
  // The bridge relays a refusal's body as text.
  assert.equal(requestErrorMessage(400, JSON.stringify(body)), expected)
  assert.equal(requestErrorMessage(500, '{"unexpected": true}'), 'The Projections runner refused the request (500)')
  assert.equal(requestErrorMessage(404, ''), 'The Projections runner refused the request (404)')
  assert.equal(requestErrorMessage(400, {error: 'Bad pair'}), 'Bad pair')
})

test('a transport subscription replaces long-polling, and aborting a message request tells the bridge', async () => {
  const seen = []
  const client = createInspectorClient({
    transport: {
      origin: 'http://127.0.0.1:1',
      request: () => Promise.reject(new Error('not used')),
      next: async (name, since) => {
        seen.push([name, since])
        return {generation: since + 1, complete: false, changes: []}
      },
    },
  })
  assert.equal((await client.changes(4)).generation, 5)
  assert.equal(await client.fixtureChanges(7), 8)
  assert.deepEqual(seen, [
    ['changes', 4],
    ['fixtures', 7],
  ])

  const {transport, posted} = channel(() => undefined)
  const abort = new AbortController()
  const pending = transport.request({method: 'GET', path: '/api/changes?since=1', signal: abort.signal})
  abort.abort()
  await assert.rejects(pending)
  assert.deepEqual(posted.at(-1), {tag: transportTag, type: 'abort', id: posted[0].id})
  transport.dispose()
})

test('binary responses arrive as Blobs over the message transport', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
  const {transport, posted} = channel(() => ({
    type: 'response',
    status: 200,
    body: {type: 'image/png', base64: Buffer.from(png).toString('base64')},
  }))
  const relayed = await transport.request({method: 'GET', path: '/api/sweep/thumbnail?x=1', responseType: 'blob'})
  assert.equal(posted[0].responseType, 'blob')
  assert.equal(relayed.type, 'image/png')
  assert.deepEqual(new Uint8Array(await relayed.arrayBuffer()), png)
})

test('bridges accept only well-formed /api/ requests', () => {
  assert.equal(parseTransportMessage({tag: transportTag, type: 'request', id: 1, method: 'GET', path: '/api/pairs'})?.path, '/api/pairs')
  assert.equal(parseTransportMessage({tag: transportTag, type: 'request', id: 1, method: 'DELETE', path: '/api/pairs'}), undefined)
  assert.equal(parseTransportMessage({tag: transportTag, type: 'request', id: 1, method: 'GET', path: '/index.html'}), undefined)
  assert.equal(parseTransportMessage({tag: transportTag, type: 'request', id: 1, method: 'GET', path: '/api/x', body: {}}), undefined)
  assert.equal(parseTransportMessage({tag: 'other', type: 'request', id: 1, method: 'GET', path: '/api/x'}), undefined)
  assert.deepEqual(parseTransportMessage({tag: transportTag, type: 'abort', id: 3}), {tag: transportTag, type: 'abort', id: 3})
})

test('only cross-origin web links are external', () => {
  assert.equal(externalUrl('https://github.com/x', 'http://127.0.0.1:1/'), 'https://github.com/x')
  assert.equal(externalUrl('/api/x', 'http://127.0.0.1:1/'), undefined)
  assert.equal(externalUrl('javascript:alert(1)', 'http://127.0.0.1:1/'), undefined)
  assert.equal(externalUrl(null, 'http://127.0.0.1:1/'), undefined)
})

test('a message transport with subscriptions asks its bridge for the next change, and aborting tells the bridge', async () => {
  const listeners = new Set()
  const posted = []
  const transport = createMessageTransport({
    origin: 'http://stdio.invalid',
    subscriptions: true,
    post: message => {
      posted.push(message)
      const parsed = parseTransportMessage(message)
      if (parsed?.type === 'next' && parsed.since === 3) {
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener({
              tag: transportTag,
              id: parsed.id,
              type: 'response',
              status: 200,
              body: {generation: 4, changes: ['definitions'], complete: true},
            })
          }
        })
      }
    },
    listen: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })
  const client = createInspectorClient({transport})
  assert.deepEqual(await client.changes(3), {generation: 4, changes: ['definitions'], complete: true})
  assert.deepEqual(posted[0], {tag: transportTag, type: 'next', id: posted[0].id, channel: 'changes', since: 3})
  const abort = new AbortController()
  const waiting = transport.next('changes', 4, abort.signal)
  abort.abort()
  await assert.rejects(waiting)
  assert.deepEqual(posted.at(-1), {tag: transportTag, type: 'abort', id: posted.at(-2).id})
  // Without subscriptions there is no `next`, so the client long-polls through `request`.
  assert.equal(createMessageTransport({post: noop, listen: () => noop}).next, undefined)
  assert.deepEqual(parseTransportMessage({tag: transportTag, type: 'next', id: 1, channel: 'fixtures', since: 0}), {
    tag: transportTag,
    type: 'next',
    id: 1,
    channel: 'fixtures',
    since: 0,
  })
  for (const message of [
    {tag: transportTag, type: 'next', id: 1, channel: 'other', since: 0},
    {tag: transportTag, type: 'next', id: 1, channel: 'changes', since: -1},
    {tag: transportTag, type: 'next', id: 1, channel: 'changes', since: 1.5},
  ]) {
    assert.equal(parseTransportMessage(message), undefined)
  }
  transport.dispose()
})

test('including asks GET /api/definitions to list an opened candidate, and leaves other requests alone', async () => {
  const seen = []
  const next = async () => ({generation: 1, changes: [], complete: true})
  const transport = including(
    {origin: 'http://stdio.invalid', request: async request => (seen.push(request.path), {}), next},
    'repository-map',
  )
  await transport.request({method: 'GET', path: '/api/definitions?ref=working-tree'})
  await transport.request({method: 'GET', path: '/api/definitions?ref=HEAD&include=other'})
  await transport.request({method: 'GET', path: '/api/revisions'})
  assert.deepEqual(seen, [
    '/api/definitions?ref=working-tree&include=repository-map',
    '/api/definitions?ref=HEAD&include=repository-map',
    '/api/revisions',
  ])
  assert.equal(transport.origin, 'http://stdio.invalid')
  assert.equal(typeof transport.next, 'function')
})
