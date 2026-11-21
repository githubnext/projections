// The projection's selectors and selection without React: the row filter and payloads keep each result's identity while
// its inputs do, the interaction reducer, the selection helpers and the status events.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {subjectRows} from '../dist/index.js'
import {createRowFilter} from '../dist/projection/filtering.js'
import {createRendererPayloads} from '../dist/projection/payloads.js'
import {initialInteraction, interaction} from '../dist/projection/interaction.js'
import {createSelectionReport, selectedPaths, selectedTarget, selectionOf, targetSelection} from '../dist/projection/selection.js'
import {createStatusEvents} from '../dist/projection/paint.js'

const extraction = entities => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships: []})
const item = (id, label = id) => ({id, kind: 'service', label, data: {}})
const before = extraction([item('api'), item('web'), item('db')])
const after = extraction([item('api', 'API'), item('web'), item('db')])
const comparison = {
  protocolVersion: 0,
  changes: [{id: 'api', collection: 'entities', before: ['api'], after: ['api'], status: 'modified', correspondence: 'exact'}],
  steps: [],
}
const subject = {mode: 'comparison', before, after, comparison}
const rows = subjectRows(subject)
const summary = []
const filters = (change = {}) => ({
  scope: 'all',
  variedOnly: false,
  regeneratedOnly: false,
  summaryFilter: null,
  changesOnly: false,
  search: '',
  ...change,
})

test('the row filter keeps its result while its inputs are the same, and recomputes only what changed', () => {
  const select = createRowFilter()
  const state = filters()
  const first = select(rows, subject, state, summary)
  assert.equal(select(rows, subject, state, summary), first)
  assert.equal(first.visibleRows.length, 3)
  // Find narrows the rows; the counts are of the same rows and keep their identity.
  const found = select(rows, subject, filters({search: 'web'}), summary)
  assert.deepEqual(
    found.visibleRows.map(row => row.id),
    ['web'],
  )
  assert.equal(found.counts, first.counts)
  assert.deepEqual(found.filter.ids, ['web'])
  // Changes lays out the changes and their context.
  const changes = select(rows, subject, filters({scope: 'changes', changesOnly: true}), summary)
  assert.equal(changes.filter.changesOnly, true)
  assert.equal(changes.counts.changes, 1)
})

const options = (change = {}) => ({subject, projection: {id: 'p', title: 'P'}, ...change})
const input = (change = {}) => ({
  options: options(),
  renderer: {name: 'graph'},
  mode: 'animated',
  progress: 0.5,
  direction: 1,
  highlighting: 'auto',
  theme: {colorMode: 'light'},
  reducedMotion: false,
  ...change,
})

test('the payloads keep their identity while what they are made of does; the environment never remakes the init', () => {
  const select = createRendererPayloads()
  const base = input()
  const first = select(base)
  assert.equal(select({...base}), first)
  const moved = select({...base, progress: 0.75})
  assert.notEqual(moved.progressPayload, first.progressPayload)
  assert.equal(moved.init, first.init)
  assert.equal(moved.endpoints, first.endpoints)
  const dark = select({...base, theme: {colorMode: 'dark'}})
  assert.notEqual(dark.environment, first.environment)
  assert.equal(dark.init, first.init)
  // A focus is compared by value.
  const focused = select({...base, options: options({focus: {on: 'changes'}})})
  assert.notEqual(focused.init, first.init)
  assert.equal(select({...base, options: options({focus: {on: 'changes'}})}).init, focused.init)
})

test('a static diff gets a progress only once highlighting was turned off in it', () => {
  const select = createRendererPayloads()
  // A host commits each read it shows.
  const shown = change => {
    const payloads = select(input(change))
    select.commit()
    return payloads
  }
  assert.equal(shown({mode: 'diff'}).diffProgress, undefined)
  assert.deepEqual(shown({mode: 'diff', highlighting: 'off'}).diffProgress, {progress: 1, highlighting: 0, direction: 1})
  assert.deepEqual(shown({mode: 'diff'}).diffProgress, {progress: 1, highlighting: 1, direction: 1})
  shown({mode: 'animated'})
  assert.equal(shown({mode: 'diff'}).diffProgress, undefined)
})

test('a computation that is never committed costs the committed results nothing', () => {
  const select = createRendererPayloads()
  const shown = select(input())
  select.commit()
  // A render for another subject, thrown away.
  select(input({options: options({subject: {mode: 'extraction', extraction: after}})}))
  assert.equal(select(input()).init, shown.init)
  const filter = createRowFilter()
  const kept = filter(rows, subject, filters(), summary)
  filter.commit()
  filter(rows, subject, filters({search: 'web'}), summary)
  assert.equal(filter(rows, subject, filters(), summary), kept)
})

test('a focus the host changes in place is a new init, and the init holds a copy of it', () => {
  const select = createRendererPayloads()
  const focus = {on: 'changes'}
  const first = select(input({options: options({focus})})).init
  select.commit()
  focus.on = 'all'
  const second = select(input({options: options({focus})})).init
  assert.notEqual(second, first)
  assert.deepEqual(first.focus, {on: 'changes'})
  assert.deepEqual(second.focus, {on: 'all'})
  assert.notEqual(second.focus, focus)
})

test('the interaction keeps its state when an event changes nothing, and a restart clears it', () => {
  const target = {side: 'after', path: '/name'}
  const rect = {x: 1, y: 2, width: 3, height: 4}
  let state = interaction(initialInteraction, {type: 'selected', rowId: 'api', target})
  assert.deepEqual(state.pinned, {rowId: 'api', target})
  state = interaction(state, {type: 'hovered', rowId: 'web'})
  state = interaction(state, {type: 'anchored', side: 'after', rowId: 'api', rect})
  assert.equal(interaction(state, {type: 'hovered', rowId: 'web'}), state)
  assert.equal(interaction(state, {type: 'anchored', side: 'after', rowId: 'api', rect: {...rect}}), state)
  assert.equal(interaction(state, {type: 'frameReplaced', side: 'before'}), state)
  assert.deepEqual(interaction(state, {type: 'frameReplaced', side: 'after'}).anchors.after, {})
  assert.equal(interaction(state, {type: 'restarted'}), initialInteraction)
  assert.equal(interaction(state, {type: 'selected', rowId: 'web'}).pinned, null)
})

test('the selection pins a target only to its row, and a renderer selection picks its pane’s side', () => {
  const pinned = {rowId: 'api', target: {side: 'before', path: '/label'}}
  const selection = selectionOf('api', rows, subject, pinned)
  assert.equal(selection.target, pinned.target)
  assert.deepEqual(selectedPaths(selection), {main: '/label', before: '/label', after: undefined})
  assert.equal(selectionOf('web', rows, subject, pinned).target, undefined)
  assert.equal(selectionOf(null, rows, subject, pinned), null)
  assert.equal(selectedTarget('before', 'api', '/label', rows, subject)?.side, 'before')
  assert.equal(selectedTarget('main', 'api', '/label', rows, subject)?.side, 'after')
  assert.equal(selectedTarget('main', 'api', undefined, rows, subject), undefined)
  const target = {side: 'after', path: '/x'}
  assert.deepEqual(targetSelection(target, {status: 'present', rowId: 'api'}), {rowId: 'api', target})
  assert.deepEqual(targetSelection(target, {status: 'missing', rowId: 'api'}), {rowId: 'api', target: {side: 'after'}})
  assert.equal(targetSelection(target, {status: 'missing'}), undefined)
})

test('selection changes are reported by value, from the first selection on', () => {
  const report = createSelectionReport()
  assert.equal(report(null), undefined)
  const selection = {rowId: 'api', targets: []}
  assert.deepEqual(report(selection), selection)
  assert.equal(report({...selection}), undefined)
  assert.equal(report(null), null)
})

test('status events: the status when it changes, and painted once each time the frames settle while paused', () => {
  const told = []
  const events = {onRendererStatusChange: status => told.push(status), onPainted: painted => told.push(painted)}
  const tell = createStatusEvents()
  const view = {status: 'loading', paint: 'loading', playing: false, mode: 'animated', progress: 1}
  tell(view, events)
  tell({...view, status: 'ready', paint: 'painting'}, events)
  tell({...view, status: 'ready', paint: 'painted'}, events)
  tell({...view, status: 'ready', paint: 'painted'}, events)
  tell({...view, status: 'ready', paint: 'painted', playing: true}, events)
  tell({...view, status: 'ready', paint: 'painted'}, events)
  assert.deepEqual(told, ['loading', 'ready', {mode: 'animated', progress: 1}, {mode: 'animated', progress: 1}])
})
