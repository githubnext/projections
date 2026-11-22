// The webview page's lifecycle (`page-lifecycle.ts`): commands sent to the Inspector wait for the page, follow it across
// reloads and are always settled, never left waiting on a page that won't answer.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createActor} from '@githubnext/projections-machine'
import {explore} from '@githubnext/projections-machine/testing'
import {failures, pageLifecycle} from '../src/panels/page-lifecycle.ts'

const control = (id, timeoutMs = 30_000) => ({id, message: {op: 'refresh'}, timeoutMs})

/** An actor on a page that is loading its first load, recording what it posts and settles; stopped after the test. */
function page(t) {
  const log = []
  const actor = createActor(pageLifecycle, {
    state: {kind: 'loading', page: 1, waiting: []},
    effects: {
      post: effect => log.push(`post ${effect.control.id}`),
      resolve: ({id, result}) => log.push(`resolve ${id} ${result}`),
      reject: ({id, reason}) => log.push(`reject ${id} ${reason}`),
    },
  })
  actor.start()
  t.after(() => actor.stop())
  return {actor, log}
}

test('a control asked for while the page loads is posted once it is ready, even when it loads again meanwhile', t => {
  const {actor, log} = page(t)
  actor.send({type: 'asked', control: control(1)})
  // The backend was replaced before the page was ready: the extension loads it again. The control used to wait on the
  // first load's ready, which never came.
  actor.send({type: 'loaded', page: 2})
  actor.send({type: 'ready', page: 2})
  assert.deepEqual(log, ['post 1'])
  actor.send({type: 'answered', id: 1, result: 'ok'})
  assert.deepEqual(log, ['post 1', 'resolve 1 ok'])
})

test("a ready from a load whose HTML was replaced isn't the page's", t => {
  const {actor, log} = page(t)
  actor.send({type: 'asked', control: control(1)})
  actor.send({type: 'loaded', page: 2})
  actor.send({type: 'ready', page: 1})
  assert.equal(actor.getState().kind, 'loading')
  assert.deepEqual(log, [])
})

test('a page that never gets ready fails its controls when their time runs out, counted from when they were asked for', t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  const {actor, log} = page(t)
  actor.send({type: 'asked', control: control(1, 1000)})
  t.mock.timers.tick(600)
  actor.send({type: 'loaded', page: 2})
  t.mock.timers.tick(400)
  assert.deepEqual(log, [`reject 1 ${failures.timeout}`])
  assert.deepEqual(actor.getState(), {kind: 'loading', page: 2, waiting: []})
})

test('closing fails the controls waiting for the page, and any asked for after', t => {
  const {actor, log} = page(t)
  actor.send({type: 'asked', control: control(1)})
  actor.send({type: 'closed'})
  actor.send({type: 'asked', control: control(2)})
  assert.deepEqual(log, [`reject 1 ${failures.closed}`, `reject 2 ${failures.closed}`])
})

test('a control posted to a page that reloads before answering fails at once', t => {
  const {actor, log} = page(t)
  actor.send({type: 'ready', page: 1})
  actor.send({type: 'asked', control: control(1)})
  // VS Code dropped the hidden tab's page and loaded it again.
  actor.send({type: 'dropped'})
  actor.send({type: 'answered', id: 1, result: 'late'})
  assert.deepEqual(log, ['post 1', `reject 1 ${failures.reloaded}`])
  assert.deepEqual(actor.getState(), {kind: 'loading', page: 1, waiting: []})
})

test('every control is posted once and settled once, whatever the page does', () => {
  const ids = state => (state.kind === 'loading' ? state.waiting : state.kind === 'ready' ? state.sent : []).map(queued => queued.id)
  const posted = (effects, id) => effects.filter(effect => effect.type === 'post' && effect.control.id === id).length
  const settled = (effects, id) =>
    effects.filter(effect => (effect.type === 'resolve' || effect.type === 'reject') && effect.id === id).length
  const events = [
    {type: 'loaded', page: 2},
    {type: 'dropped'},
    {type: 'ready', page: 1},
    {type: 'ready', page: 2},
    {type: 'ready'},
    {type: 'answered', id: 1, result: 'ok'},
    {type: 'answered', id: 2, error: 'failed'},
    {type: 'expired', id: 1},
    {type: 'expired', id: 2},
    {type: 'closed'},
  ]
  const result = explore(pageLifecycle, {
    from: {kind: 'loading', page: 1, waiting: []},
    // A caller never reuses an id that is still waiting.
    events: state => [...events, ...[1, 2].filter(id => !ids(state).includes(id)).map(id => ({type: 'asked', control: control(id, 50)}))],
    depth: 8,
    invariants: {'ids are unique': state => new Set(ids(state)).size === ids(state).length},
    transitions: {
      'a control that leaves is settled, once': ({from, to, effects}) =>
        ids(from).every(id => (ids(to).includes(id) ? settled(effects, id) === 0 : settled(effects, id) === 1)),
      'a control is posted when the page is ready for it, once': ({from, to, effects}) =>
        ids(to).every(id => posted(effects, id) === (to.kind === 'ready' && (from.kind !== 'ready' || !ids(from).includes(id)) ? 1 : 0)),
      'a control asked for on a closed page fails': ({from, event, effects}) =>
        from.kind !== 'closed' || event.type !== 'asked' || settled(effects, event.control.id) === 1,
    },
    complete: true,
  })
  assert.equal(result.truncated, false)
})

test("a control asked for on a ready page is posted before its timeout starts, so it's measured from the post", t => {
  const {actor, log} = page(t)
  actor.send({type: 'ready', page: 1})
  const timers = t.mock.method(globalThis, 'setTimeout', (callback, ms) => {
    log.push(`timeout ${ms}`)
    return 0
  })
  actor.send({type: 'asked', control: control(2, 5_000)})
  assert.deepEqual(log, ['post 2', 'timeout 5000'])
  timers.mock.restore()
})
