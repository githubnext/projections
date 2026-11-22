// The projection as a store without React (`createProjection`): its controller, its changes and reports, a new subject,
// controlled settings, the modes and controls a renderer declares.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createProjection} from '../dist/index.js'

const extraction = entities => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships: []})
const item = (id, label = id) => ({id, kind: 'service', label, data: {}})
const comparisonOf = (before, after, changes) => ({mode: 'comparison', before, after, comparison: {protocolVersion: 0, changes, steps: []}})
const modified = id => ({id, collection: 'entities', before: [id], after: [id], status: 'modified', correspondence: 'exact'})
const subject = comparisonOf(extraction([item('api'), item('web')]), extraction([item('api', 'API'), item('web')]), [modified('api')])
const renderer = {name: 'graph', title: 'Graph', handles: [], url: '/graph/index.html', source: 'builtin'}
const options = (change = {}) => ({subject, projection: {id: 'p', title: 'P'}, renderers: [renderer], ...change})
const capabilities = (change = {}) => ({protocolVersion: 1, ...change})
const ready = (change = {}) => ({
  status: 'ready',
  steps: [],
  rendererErrors: [],
  rejected: 0,
  controls: [],
  capabilities: capabilities(),
  ...change,
})

/** The renderer reports `pane` in every pane: the shown ones depend on the mode (side by side by default). */
const report = (snapshot, pane) => {
  for (const key of ['main', 'before', 'after']) snapshot().stage.onPaneState[key](pane)
}

/** A started store, counting the changes its listener hears. */
function started(change) {
  const store = createProjection(options(change))
  let heard = 0
  store.subscribe(() => heard++)
  store.start()
  return {store, heard: () => heard, snapshot: () => store.getSnapshot()}
}

test('the controller is a settled snapshot: the same object until something changes, and listeners hear each change', () => {
  const progress = []
  const {store, heard, snapshot} = started({onProgressChange: value => progress.push(value)})
  const first = snapshot()
  assert.equal(first.comparing, true)
  assert.equal(first.scope, 'changes')
  assert.equal(first.rendererStatus, 'loading')
  assert.deepEqual(progress, [1])
  assert.equal(store.getSnapshot(), first)
  const before = heard()
  first.setScope('all')
  assert.equal(snapshot().scope, 'all')
  assert.ok(heard() > before)
  assert.equal(snapshot().visibleRows.length, 2)
  store.stop()
})

test('renderer reports reach the controller through the stage binding', () => {
  const statuses = []
  const {snapshot} = started({onRendererStatusChange: status => statuses.push(status)})
  report(snapshot, ready())
  assert.equal(snapshot().rendererStatus, 'ready')
  assert.deepEqual(statuses, ['loading', 'ready'])
  snapshot().hover('api')
  assert.equal(snapshot().hoveredId, 'api')
})

test('a new subject starts over: the selection clears and is reported, the hover goes', () => {
  const selected = []
  const {store, snapshot} = started({onSelectedIdChange: id => selected.push(id)})
  snapshot().select('api')
  snapshot().hover('web')
  assert.equal(snapshot().selectedRow?.label, 'API')
  const next = comparisonOf(extraction([item('db')]), extraction([item('db')]), [])
  store.update(options({subject: next, onSelectedIdChange: id => selected.push(id)}))
  assert.equal(snapshot().subject, next)
  assert.equal(snapshot().selectedId, null)
  assert.equal(snapshot().hoveredId, null)
  // Uncontrolled, a selection is told as it is asked for and as it is shown; a new subject's reset as it is shown.
  assert.deepEqual(selected, [null, 'api', 'api', null])
})

test('a controlled setting is requested, not changed, until the embedder changes it', () => {
  const asked = []
  const {store, snapshot} = started({changesOnly: true, onChangesOnlyChange: next => asked.push(next)})
  snapshot().setScope('all')
  assert.deepEqual(asked, [false])
  assert.equal(snapshot().scope, 'changes')
  store.update(options({changesOnly: false, onChangesOnlyChange: next => asked.push(next)}))
  assert.equal(snapshot().scope, 'all')
})

test('a chosen mode the ready renderer lacks becomes one it offers, and is reported', () => {
  const modes = []
  const {snapshot} = started({initialMode: 'diff', onModeChange: mode => modes.push(mode)})
  // Until the renderer says which modes it supports, the chosen one is kept.
  assert.equal(snapshot().mode, 'diff')
  snapshot().stage.onPaneState.main(ready({capabilities: capabilities({comparisonModes: ['animated', 'side-by-side']})}))
  assert.equal(snapshot().modesKnown, true)
  assert.notEqual(snapshot().mode, 'diff')
  assert.deepEqual(modes, [snapshot().mode])
})

test('the definition seeds the controls a renderer declares, once, with notices for what it lacks', () => {
  const zoom = {id: 'zoom', type: 'toggle', label: 'Zoom', default: false}
  const {snapshot} = started({presentation: {rendererOptions: {zoom: true, missing: 1}}})
  report(snapshot, ready({controls: [zoom]}))
  assert.equal(snapshot().controlValues.zoom, true)
  assert.equal(snapshot().notices.length, 1)
  snapshot().setControl('zoom', false)
  assert.equal(snapshot().controlValues.zoom, false)
  // The same declaration again seeds nothing.
  report(snapshot, ready({controls: [{...zoom}]}))
  assert.equal(snapshot().controlValues.zoom, false)
})

test('an action counts each run, so running it again is news to the renderer', () => {
  const run = []
  const action = {id: 'fit', type: 'action', label: 'Fit'}
  const {snapshot} = started({onAction: id => run.push(id)})
  report(snapshot, ready({controls: [action]}))
  snapshot().runAction('fit')
  const first = snapshot().stage.action
  snapshot().runAction('fit')
  assert.deepEqual(run, ['fit', 'fit'])
  assert.notEqual(snapshot().stage.action, first)
  assert.equal(snapshot().stage.action.sequence, 2)
  snapshot().runAction('missing')
  assert.equal(run.length, 2)
})

test('an action reaches listeners once, after its handlers, so they never see a half-done change', () => {
  const seen = []
  const asked = []
  const store = createProjection(options({onChangesOnlyChange: next => asked.push(next)}))
  store.start()
  store.subscribe(() => seen.push({scope: store.getSnapshot().scope, asked: asked.length}))
  store.getSnapshot().setScope('all')
  assert.deepEqual(seen, [{scope: 'all', asked: 1}])
  seen.length = 0
  // The pinned target and the selected row: two writes, one change.
  store.getSnapshot().selectTarget({kind: 'entity', id: 'api', side: 'after'})
  assert.equal(seen.length, 1)
  assert.deepEqual(store.getSnapshot().selection?.target, {kind: 'entity', id: 'api', side: 'after'})
})

test('a handler told of a selection reads it in the snapshot', () => {
  let read
  const store = createProjection(options({onSelectedIdChange: () => (read = store.getSnapshot().selectedId)}))
  store.start()
  store.getSnapshot().select('api')
  assert.equal(read, 'api')
})

test('a projection that never settles says so, and its snapshot still shows the state as it is', () => {
  const errors = []
  const original = globalThis.reportError
  globalThis.reportError = error => errors.push(error)
  try {
    // An embedder that answers every selection it is told of with the other row.
    const store = createProjection(
      options({onSelectionChange: selection => selection && store.getSnapshot().select(selection.rowId === 'api' ? 'web' : 'api')}),
    )
    store.start()
    store.getSnapshot().select('api')
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /didn't settle/u)
    assert.ok(['api', 'web'].includes(store.getSnapshot().selectedId))
  } finally {
    globalThis.reportError = original
  }
})

test('stopping while the first preferences are told stops watching them', () => {
  const removed = []
  const original = globalThis.window
  globalThis.window = {
    matchMedia: query => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => removed.push(query),
    }),
  }
  try {
    const store = createProjection(options())
    store.subscribe(() => store.stop())
    store.start()
    assert.equal(removed.length, 2)
  } finally {
    globalThis.window = original
  }
})
