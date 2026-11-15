import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createFrame, diffEmphasis, filterFrame, initialViewerState, presentComparison, scheduleSteps, viewerReducer} from '../dist/index.js'

const a = {id: 'a', kind: 'service', label: 'API'}
const b = {id: 'b', kind: 'queue', label: 'Queue'}
const c = {id: 'c', kind: 'service', label: 'Worker'}
const before = {protocolVersion: 0, schema: 'graph/v0', entities: [a, b], relationships: [{id: 'e', kind: 'calls', from: 'a', to: 'b'}]}
const after = {protocolVersion: 0, schema: 'graph/v0', entities: [a, c], relationships: [{id: 'e', kind: 'calls', from: 'a', to: 'c'}]}
const comparison = presentComparison(before, after, {
  protocolVersion: 0,
  changes: [
    {id: 'b', collection: 'entities', before: ['b'], after: [], status: 'removed', correspondence: 'none'},
    {id: 'c', collection: 'entities', before: [], after: ['c'], status: 'added', correspondence: 'none'},
    {id: 'e', collection: 'relationships', before: ['e'], after: ['e'], status: 'modified', correspondence: 'exact'},
  ],
  steps: [
    {changes: ['b'], kind: 'remove'},
    {changes: ['e'], kind: 'restructure'},
    {changes: ['c'], kind: 'add'},
  ],
})

test('one deterministic clock, neutral exact endpoints and incident-edge timing', () => {
  const [removal, , addition] = scheduleSteps(comparison)
  for (const t of Array.from({length: 101}, (_, i) => i / 100)) {
    const frame = createFrame(after, comparison, t)
    assert.deepEqual(frame, createFrame(after, comparison, t))
    for (const edge of frame.edges) {
      const from = frame.nodes.find(node => node.id === edge.from)
      const to = frame.nodes.find(node => node.id === edge.to)
      assert.ok(from && to)
      assert.ok(edge.opacity <= Math.min(from.opacity, to.opacity))
    }
    // Between the queue leaving and the worker arriving, the rewired call has no endpoint to draw to.
    if (t >= removal.time + removal.radius && t <= addition.time - addition.radius) assert.equal(frame.edges.length, 0)
  }
  assert.deepEqual(
    createFrame(after, comparison, 0).nodes.map(node => node.id),
    ['a', 'b'],
  )
  assert.deepEqual(
    createFrame(after, comparison, 1).nodes.map(node => node.id),
    ['a', 'c'],
  )
  assert.equal(diffEmphasis(0), 0)
  assert.equal(diffEmphasis(1), 0)
  assert.equal(createFrame(after).progress, 1)
  assert.equal(createFrame(after).emphasis, 0)
})

test('play, seek and reverse use bounded elapsed time and stop at endpoints', () => {
  let state = viewerReducer(initialViewerState(), {type: 'play', direction: 1})
  assert.equal(state.progress, 0)
  state = viewerReducer(state, {type: 'advance', elapsedMs: 2000, durationMs: 4000})
  assert.equal(state.progress, 0.5)
  state = viewerReducer(state, {type: 'play', direction: -1})
  state = viewerReducer(state, {type: 'advance', elapsedMs: 4000, durationMs: 4000})
  assert.equal(state.progress, 0)
  assert.equal(state.playing, false)
  state = viewerReducer(state, {type: 'play', direction: -1})
  state = viewerReducer(state, {type: 'advance', elapsedMs: 0, durationMs: 4000})
  assert.equal(state.progress, 1)
  assert.equal(state.playing, true)
  assert.equal(viewerReducer(state, {type: 'seek', value: 0.83}).progress, 0.83)
  assert.throws(() => viewerReducer(state, {type: 'seek', value: NaN}), /finite/)
  assert.throws(() => viewerReducer(state, {type: 'advance', elapsedMs: 1, durationMs: 0}), /duration/)
})

test('initial and reset state start paused at the requested progress', () => {
  const initial = initialViewerState(0.4)
  assert.equal(initial.progress, 0.4)
  assert.equal(initial.playing, false)
  assert.equal('mode' in initial, false)
  assert.equal('swipe' in initial, false)
  const changed = viewerReducer(viewerReducer(initial, {type: 'play', direction: 1}), {type: 'search', value: 'x'})
  assert.deepEqual(viewerReducer(changed, {type: 'reset', progress: 0.4}), initial)
  assert.equal(viewerReducer(changed, {type: 'reset'}).progress, 1)
})

test('searching an edge retains endpoints rather than presenting a dangling relationship', () => {
  const frame = filterFrame(createFrame(after), {...initialViewerState(), search: 'calls'})
  assert.equal(frame.edges.length, 1)
  assert.equal(frame.nodes.length, 2)
})

test('comparisons expand into before/after pairs, including splits and merges, without inferring identity', () => {
  assert.deepEqual(
    comparison.entities.map(change => [change.id, change.status, change.before?.id, change.after?.id]),
    [
      ['a', 'unchanged', 'a', 'a'],
      ['b', 'removed', 'b', undefined],
      ['c', 'added', undefined, 'c'],
    ],
  )
  const billing = {id: 'billing', kind: 'service', label: 'Billing'}
  const invoicing = {id: 'invoicing', kind: 'service', label: 'Invoicing'}
  const payments = {id: 'payments', kind: 'service', label: 'Payments'}
  const extraction = entities => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships: []})
  const split = presentComparison(extraction([billing]), extraction([invoicing, payments]), {
    protocolVersion: 0,
    steps: [{changes: ['invoicing']}],
    changes: [
      {
        id: 'invoicing',
        collection: 'entities',
        before: ['billing'],
        after: ['invoicing', 'payments'],
        status: 'modified',
        correspondence: 'split',
      },
    ],
  })
  assert.deepEqual(
    split.entities.map(change => [change.id, change.before?.id, change.after?.id, change.correspondence]),
    [
      ['invoicing', 'billing', 'invoicing', 'split'],
      ['payments', undefined, 'payments', 'split'],
    ],
  )
  const merge = presentComparison(extraction([invoicing, payments]), extraction([billing]), {
    protocolVersion: 0,
    steps: [{changes: ['billing']}],
    changes: [
      {
        id: 'billing',
        collection: 'entities',
        before: ['invoicing', 'payments'],
        after: ['billing'],
        status: 'modified',
        correspondence: 'merge',
      },
    ],
  })
  assert.deepEqual(
    merge.entities.map(change => [change.id, change.before?.id, change.after?.id]),
    [
      ['billing', 'invoicing', 'billing'],
      ['payments', 'payments', undefined],
    ],
  )
  assert.throws(
    () => presentComparison(extraction([billing]), extraction([invoicing]), {protocolVersion: 0, changes: [], steps: []}),
    /omits/,
  )
})
