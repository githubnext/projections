import {test} from 'node:test'
import assert from 'node:assert/strict'
import {offeredViews, scopeChoice, shownView, summaryToggle, viewControls} from '../dist/index.js'

const renderer = {name: 'graph', title: 'Graph', source: 'builtin', url: 'graph.html'}
const zoom = {id: 'zoom-in', type: 'action', label: 'Zoom in', group: 'zoom'}
const projection = (overrides = {}) => ({
  comparing: true,
  mode: 'animated',
  renderer,
  availableModes: ['side-by-side', 'animated'],
  controls: [zoom],
  rendererStatus: 'ready',
  variation: undefined,
  ...overrides,
})

test('the views are the renderer, then the built-in views the features keep, and never none', () => {
  assert.deepEqual(offeredViews({renderer}), ['renderer', 'table', 'text'])
  assert.deepEqual(offeredViews({renderer: undefined}, {table: false}), ['text'])
  assert.deepEqual(offeredViews({renderer: undefined}, {table: false, text: false}), ['table'])
  assert.equal(shownView(['renderer', 'table'], 'text'), 'renderer')
  assert.equal(shownView(['renderer', 'table'], 'table'), 'table')
})

test('playback shows only in the Animated mode by default, beside every view', () => {
  for (const view of ['renderer', 'table', 'text']) {
    assert.equal(viewControls(projection(), {view}).playback, true, view)
    assert.equal(viewControls(projection({mode: 'side-by-side'}), {view}).playback, false, view)
  }
  assert.equal(viewControls(projection({comparing: false}), {view: 'renderer'}).playback, false)
  assert.equal(viewControls(projection(), {view: 'renderer', features: {playback: false}}).playback, false)
})

test('a host may show playback beside the table and text views in every mode', () => {
  const options = {playbackInViews: 'always'}
  assert.equal(viewControls(projection({mode: 'side-by-side'}), {...options, view: 'table'}).playback, true)
  assert.equal(viewControls(projection({mode: 'side-by-side'}), {...options, view: 'renderer'}).playback, false)
})

test('the mode switch offers the modes both the features and the renderer allow, in the renderer order', () => {
  const both = viewControls(projection(), {view: 'renderer'})
  assert.deepEqual(both.modes, ['side-by-side', 'animated'])
  assert.equal(both.modeSwitch, true)
  const one = viewControls(projection(), {view: 'renderer', features: {modes: ['animated', 'diff']}})
  assert.deepEqual(one.modes, ['animated'])
  assert.equal(one.modeSwitch, false)
  assert.equal(viewControls(projection(), {view: 'table'}).modeSwitch, false)
  assert.deepEqual(viewControls(projection(), {view: 'renderer', features: {modes: false}}).modes, [])
})

test('the zoom group needs renderer controls, and draws nothing while the renderer has failed', () => {
  assert.deepEqual(viewControls(projection(), {view: 'renderer'}).zoomControls, [zoom])
  assert.equal(viewControls(projection(), {view: 'renderer', features: {rendererControls: false}}).zoom, false)
  const failed = viewControls(projection({rendererStatus: 'failed'}), {view: 'renderer'})
  assert.equal(failed.zoom, true)
  assert.deepEqual(failed.zoomControls, [])
})

test('the varied toggle is the toolbar’s only without a summary bar', () => {
  const varied = projection({variation: {within: 2, beyond: 0, regenerated: 0}})
  assert.equal(viewControls(varied, {view: 'renderer'}).varied, false)
  assert.equal(viewControls(varied, {view: 'renderer', features: {summary: false}}).varied, true)
})

test('the scope switch offers Changes and All, Noise only while it is the scope, and a note when nothing is hidden', () => {
  const counts = {changes: 4, all: 412, noise: 3, hidden: 408}
  const choice = scopeChoice({scope: 'changes', scopeCounts: counts})
  assert.deepEqual(
    choice.options.map(option => [option.scope, option.label]),
    [
      ['changes', 'Changes'],
      ['all', 'All'],
    ],
  )
  assert.equal(choice.options[1].title, 'Show every item (412)')
  assert.equal(choice.nothingHidden, false)
  assert.deepEqual(
    scopeChoice({scope: 'noise', scopeCounts: counts}).options.map(option => option.scope),
    ['changes', 'all', 'noise'],
  )
  assert.equal(scopeChoice({scope: 'changes', scopeCounts: {...counts, hidden: 0}}).nothingHidden, true)
  assert.equal(scopeChoice({scope: 'noise', scopeCounts: {...counts, hidden: 0}}).nothingHidden, false)
})

test('a summary toggle sets its filter, and clears it when pressed again', () => {
  const figure = {type: 'count', key: 'tables', kinds: [{kind: 'table'}], noun: {singular: 'table', plural: 'tables'}}
  const off = summaryToggle(null, figure, 'added')
  assert.equal(off.pressed, false)
  assert.deepEqual(off.next, {kinds: [{kind: 'table'}], status: 'added'})
  const on = summaryToggle(off.next, figure, 'added')
  assert.equal(on.pressed, true)
  assert.equal(on.next, null)
  assert.equal(summaryToggle(off.next, figure).pressed, false)
})
