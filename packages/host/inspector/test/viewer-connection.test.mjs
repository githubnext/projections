// The agent viewer page's connection (`viewer/lifecycle.ts`): the long poll, stopping and resuming, a replacing server,
// reports one at a time, and which generation is the page's own report's echo.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {explore} from '@githubnext/projections-machine/testing'
import {retryMs, viewerConnection} from '../dist/ui/viewer/lifecycle.js'
import {echoes} from '../dist/ui/viewer/page.js'

const start = {
  kind: 'live',
  state: undefined,
  instance: undefined,
  build: undefined,
  mounted: false,
  outbox: {sending: false, next: null, last: ''},
  asks: 0,
  since: undefined,
}
const answer = (generation, extra = {}) => ({generation, refresh: 0, instance: 'one', projection: 'map', ...extra})
const report = text => ({type: 'report', report: {body: {text}, text}})

function run(state, ...events) {
  const effects = []
  for (const event of events) {
    const step = viewerConnection.transition(state, event)
    state = step.state
    effects.push(...step.effects)
  }
  return {state, effects}
}
const posts = effects => effects.filter(effect => effect.type === 'post').map(effect => effect.body.text)

test('reports go one at a time: the latest waits for the one in flight, and one that says nothing new is skipped', () => {
  const live = run(start, {type: 'answered', answer: answer(1)}).state
  const sent = run(live, report('a'), report('b'), report('c'), report('c'))
  // Before, each report was posted every 400 ms without waiting, so an older one could arrive after a newer one.
  assert.deepEqual(posts(sent.effects), ['a'])
  const next = run(sent.state, {type: 'posted'})
  assert.deepEqual(posts(next.effects), ['c'])
  const idle = run(next.state, {type: 'posted'}, report('c'))
  assert.deepEqual(posts(idle.effects), [])
  assert.equal(idle.state.outbox.sending, false)
})

test('the first state that shows a projection mounts the Inspector, once; an answer of the same generation shows nothing', () => {
  const waiting = run(start, {type: 'answered', answer: answer(1, {projection: null})})
  assert.deepEqual(waiting.effects, [{type: 'show', state: answer(1, {projection: null}), mount: false}])
  const shown = run(waiting.state, {type: 'answered', answer: answer(2)}, {type: 'answered', answer: answer(3)})
  assert.deepEqual(
    shown.effects.map(effect => effect.mount),
    [true, false],
  )
  const same = run(shown.state, {type: 'answered', answer: answer(3, {build: {version: 1, phase: 'building'}})})
  assert.deepEqual(same.effects, [{type: 'build'}])
  assert.deepEqual(viewerConnection.activities(same.state), [{type: 'poll', key: 'poll:4', since: 3, build: 1, delayMs: 0}])
})

test("a server that stops answering stops the page, which asks again every 2 s, takes no reports, and resumes reporting when it's back", () => {
  const live = run(start, {type: 'answered', answer: answer(1)}, report('a'), {type: 'posted'}).state
  const stopped = run(live, {type: 'failed'}, report('b'))
  assert.deepEqual(stopped.effects, [{type: 'stop'}])
  assert.deepEqual(viewerConnection.activities(stopped.state), [
    {type: 'poll', key: 'poll:2', since: undefined, build: undefined, delayMs: retryMs},
  ])
  const resumed = run(stopped.state, {type: 'failed'}, {type: 'answered', answer: answer(1)}, report('a'))
  assert.equal(resumed.effects[0].type, 'resume')
  // What it reported before the server stopped may never have arrived, so it reports it again.
  assert.deepEqual(posts(resumed.effects), ['a'])
})

test('another server at the URL replaces the page, and nothing more happens', () => {
  const live = run(start, {type: 'answered', answer: answer(1)}).state
  const replaced = run(
    live,
    {type: 'answered', answer: answer(1, {instance: 'two'})},
    {type: 'answered', answer: answer(2, {instance: 'two'})},
  )
  assert.deepEqual(replaced.effects, [{type: 'reload'}])
  assert.deepEqual(viewerConnection.activities(replaced.state), [])
})

test("a generation is a page's echo only when the server says its report made it, not when another page's did", () => {
  // Pages A and B both reported at generation 4; A's arrived first and made 5. B used to take 5 for its own echo.
  assert.equal(echoes({id: 'b'}, answer(5, {reportedBy: 'a'})), false)
  assert.equal(echoes({id: 'a'}, answer(5, {reportedBy: 'a'})), true)
  assert.equal(echoes({id: 'a'}, answer(6, {reportedBy: null})), false)
})

test('every connection state keeps one report in flight at most, and replaced and ended are final', () => {
  const events = [
    {type: 'answered', answer: answer(1, {projection: null})},
    {type: 'answered', answer: answer(2)},
    {type: 'answered', answer: answer(2, {build: {version: 1, phase: 'built'}})},
    {type: 'answered', answer: answer(3, {instance: 'two'})},
    {type: 'failed'},
    report('a'),
    report('b'),
    {type: 'posted'},
    {type: 'unmounted'},
  ]
  const open = state => state.kind === 'live' || state.kind === 'stopped'
  const result = explore(viewerConnection, {
    from: start,
    events,
    depth: 6,
    key: state => JSON.stringify({...state, asks: undefined}),
    invariants: {
      'a waiting report waits for one in flight': state => !open(state) || !state.outbox.next || state.outbox.sending,
      'a stopped page has nothing to poll past': state =>
        state.kind !== 'stopped' || viewerConnection.activities(state)[0].since === undefined,
    },
    transitions: {
      'a report is posted only when none is in flight': ({from, event, effects}) =>
        posts(effects).length <= 1 && (posts(effects).length === 0 || !open(from) || !from.outbox.sending || event.type === 'posted'),
      'the Inspector mounts once': ({from, to, effects}) =>
        effects.filter(effect => effect.mount).length === 0 || (open(from) && !from.mounted && open(to) && to.mounted),
      'replaced and ended are final': ({from, to}) =>
        (from.kind !== 'replaced' && from.kind !== 'ended') || to.kind === from.kind || to.kind === 'ended',
    },
    complete: true,
  })
  assert.equal(result.truncated, false)
})
