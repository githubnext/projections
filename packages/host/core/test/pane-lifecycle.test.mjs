import {test} from 'node:test'
import assert from 'node:assert/strict'
import {explore} from '@githubnext/projections-machine/testing'
import {loadingLifecycle, paneLifecycle, paneStateOf} from '../dist/pane-lifecycle.js'

const first = {comparisonMode: 'animated'}
const capabilities = {protocolVersion: 1, controls: [{id: 'zoom', type: 'action', label: 'Zoom'}]}
const events = [
  {type: 'ready', capabilities},
  {type: 'revealed'},
  {type: 'failed', message: 'timed out'},
  {type: 'rendered', progress: 1, init: first},
  {type: 'controls', controls: []},
  {type: 'steps', ends: [0.5], slots: 3},
  {type: 'aspect', ratio: 2},
  {type: 'height', px: 300},
  {type: 'legend', items: [{label: 'Added', shape: 'swatch', token: 'color-added-muted'}]},
  {type: 'legend', items: []},
  {type: 'summary', items: [{kind: 'service'}]},
  {type: 'summary', items: []},
  {type: 'error', message: 'oops'},
  {type: 'rejected'},
  {type: 'reinit'},
  {type: 'reloaded'},
]

test('a pane is loading until revealed, fails for good, and starts over only with a new bundle', () => {
  explore(paneLifecycle, {
    from: loadingLifecycle,
    events,
    // Reports accumulate, so identity by stage and the reports' shape keeps the walk finite.
    key: state =>
      `${state.kind}|${Object.keys(state.reports).sort().join(',')}|${state.reports.rendererErrors.length}|${state.reports.rejected > 0}`,
    invariants: {
      'only a failed pane has a message': state => (state.kind === 'failed') === 'message' in state,
      'a pane keeps at most five errors': state => state.reports.rendererErrors.length <= 5,
      'a painted progress names its document': state =>
        (state.reports.rendered === undefined) === (state.reports.renderedInit === undefined),
    },
    transitions: {
      'a failed pane leaves failed only for a new bundle': ({from, event, to}) =>
        from.kind !== 'failed' || to.kind === 'failed' || event.type === 'reloaded',
      'a pane becomes ready only when revealed': ({from, event, to}) =>
        to.kind !== 'ready' || from.kind === 'ready' || event.type === 'revealed',
    },
    complete: true,
  })
})

test('the pane reports its status, failure and what its renderer said, as PaneState', () => {
  let state = loadingLifecycle
  const send = event => (state = paneLifecycle.transition(state, event).state)
  send({type: 'ready', capabilities})
  assert.deepEqual(paneStateOf(state).controls, capabilities.controls)
  assert.equal(paneStateOf(state).status, 'loading')
  send({type: 'rendered', progress: 0.5, init: first})
  send({type: 'revealed'})
  assert.equal(paneStateOf(state).status, 'ready')
  assert.equal(paneStateOf(state).rendered, 0.5)
  send({type: 'reinit'})
  assert.equal(paneStateOf(state).rendered, undefined)
  assert.equal(paneStateOf(state).renderedInit, undefined)
  const aspect = paneLifecycle.transition(state, {type: 'aspect', ratio: 2}).state
  assert.equal(paneLifecycle.transition(aspect, {type: 'aspect', ratio: 2}).state, aspect, 'the same report changes nothing')
  send({type: 'failed', message: 'navigated'})
  assert.deepEqual([paneStateOf(state).status, paneStateOf(state).message], ['failed', 'navigated'])
  send({type: 'revealed'})
  assert.equal(paneStateOf(state).status, 'failed')
  send({type: 'reloaded'})
  assert.deepEqual(paneStateOf(state), {status: 'loading', steps: [], rendererErrors: [], rejected: 0, controls: []})
})

test('a report repeating what the pane knows, in a new copy, keeps its state', () => {
  const send = (state, ...sent) => sent.reduce((current, event) => paneLifecycle.transition(current, event).state, state)
  const ready = send(loadingLifecycle, {type: 'ready', capabilities}, {type: 'revealed'})
  const reported = send(
    ready,
    {type: 'rendered', progress: 1, init: first},
    {type: 'steps', ends: [0.5], slots: 3},
    {type: 'legend', items: [{label: 'Added', shape: 'swatch', token: 'color-added-muted'}]},
    {type: 'summary', items: []},
  )
  const repeated = send(
    reported,
    {type: 'ready', capabilities: structuredClone(capabilities)},
    {type: 'rendered', progress: 1, init: first},
    {type: 'controls', controls: structuredClone(capabilities.controls)},
    {type: 'steps', ends: [0.5], slots: 3},
    {type: 'legend', items: [{label: 'Added', shape: 'swatch', token: 'color-added-muted'}]},
    {type: 'summary', items: []},
  )
  assert.equal(repeated, reported)
  // The same progress painted for another document is news.
  assert.notEqual(send(reported, {type: 'rendered', progress: 1, init: {...first}}), reported)
})
