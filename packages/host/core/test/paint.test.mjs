import {test} from 'node:test'
import assert from 'node:assert/strict'
import {paintState} from '../dist/index.js'

const noop = () => undefined

const renderer = {name: 'graph', title: 'Graph', source: 'builtin', url: 'graph.html'}
const pane = (status, rendered) => ({status, rendered, steps: [], rendererErrors: [], rejected: 0, controls: []})
const panes = (main, before = pane('loading'), after = pane('loading')) => ({main, before, after})
const state = overrides => ({renderer, comparing: true, mode: 'animated', progress: 0.5, panes: panes(pane('ready', 0.5)), ...overrides})

test('animated frames are painted once they acknowledge the progress shown', () => {
  assert.equal(paintState(state()), 'painted')
  assert.equal(paintState(state({panes: panes(pane('ready', 0.25))})), 'painting')
  assert.equal(paintState(state({panes: panes(pane('ready'))})), 'painting')
  assert.equal(paintState(state({panes: panes(pane('loading'))})), 'loading')
  assert.equal(paintState(state({panes: panes(pane('failed'))})), 'failed')
  assert.equal(paintState(state({renderer: undefined})), 'none')
})

test('two-pane modes are painted once the before pane shows its start and the after pane its end', () => {
  const twoPanes = (before, after) => state({mode: 'side-by-side', panes: panes(pane('loading'), before, after)})
  assert.equal(paintState(twoPanes(pane('ready', 0), pane('ready', 1))), 'painted')
  assert.equal(paintState(twoPanes(pane('ready', 0), pane('ready'))), 'painting')
  assert.equal(paintState(twoPanes(pane('ready', 0), pane('failed'))), 'failed')
})

test('one extraction, or a diff, is painted once its frame has painted at all', () => {
  assert.equal(paintState(state({comparing: false, panes: panes(pane('ready', 1))})), 'painted')
  assert.equal(paintState(state({mode: 'diff', panes: panes(pane('ready', 1))})), 'painted')
})

test('an acknowledgement of an earlier init does not count until the frame catches up', () => {
  const animated = {comparisonMode: 'animated'}
  const diff = {comparisonMode: 'diff'}
  const acknowledged = (init, rendered) => ({...pane('ready', rendered), renderedInit: init})
  assert.equal(paintState(state({mode: 'diff', panes: panes(acknowledged(animated, 0.5)), stage: {init: diff}})), 'painting')
  assert.equal(paintState(state({mode: 'diff', panes: panes(acknowledged(diff, 1)), stage: {init: diff}})), 'painted')
})

test('a ProjectionView reports the renderer status and painting to its embedder', async () => {
  const {viewOptions} = await import('../dist/ui/view/options.js')
  const onRendererStatusChange = noop
  const onPainted = noop
  const options = viewOptions({subject: undefined, projection: undefined, onRendererStatusChange, onPainted}, 'light', {})
  assert.equal(options.onRendererStatusChange, onRendererStatusChange)
  assert.equal(options.onPainted, onPainted)
})
