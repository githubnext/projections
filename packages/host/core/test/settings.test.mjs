import {test} from 'node:test'
import assert from 'node:assert/strict'
import {maxRendererSubmenus, settingsLabels, settingsModel} from '../dist/index.js'

/** The parts of a projection controller the Settings model reads. */
const projection = (overrides = {}) => ({
  comparing: true,
  mode: 'animated',
  reducedMotion: false,
  changesOnly: false,
  scope: 'all',
  scopeCounts: {changes: 2, all: 5, noise: 0},
  highlighting: 'animated',
  loop: true,
  holds: 'timeline',
  speed: 1,
  renderer: {name: 'graph', title: 'Graph'},
  renderers: [
    {name: 'graph', title: 'Graph'},
    {name: 'file-packing', title: 'File packing'},
    {name: 'text-diff', title: 'Text diff'},
  ],
  rendererStatus: 'ready',
  controls: [],
  controlValues: {},
  setChangesOnly() {},
  setScope() {},
  setHighlighting() {},
  setRenderer() {},
  setLoop() {},
  setHolds() {},
  setSpeed() {},
  setControl() {},
  runAction() {},
  ...overrides,
})
const showAs = {view: 'renderer', views: ['renderer', 'table', 'text'], onViewChange() {}, rendererTitle: 'Graph'}
const toggle = (id, label, extra = {}) => ({id, label, type: 'toggle', default: false, ...extra})
const zoom = [
  {id: 'zoom-out', label: 'Zoom out', type: 'action', icon: 'zoom-out', group: 'zoom'},
  {id: 'zoom-in', label: 'Zoom in', type: 'action', icon: 'zoom-in', group: 'zoom'},
]
/** Top-level items: menu items (choices and toggles count each option) and submenus. */
const topItems = model => model.groups.flatMap(group => group.entries.flatMap(entry => (entry.type === 'choice' ? entry.options : [entry])))
const submenuLabels = model =>
  model.groups.flatMap(group => group.entries.filter(entry => entry.type === 'submenu').map(entry => entry.label))

test('the top level holds Show as and the scope; the rest are submenus', () => {
  const model = settingsModel(projection(), {}, showAs)
  assert.deepEqual(
    model.groups[0].entries[0].options.map(option => option.label),
    ['Graph', 'Table', 'Text'],
  )
  assert.deepEqual(submenuLabels(model), ['Show', 'Highlight changes', 'Renderer', 'Playback'])
  // The scope's submenu shows its value, and offers Noise only when something varied.
  const scope = model.groups[1].entries[0]
  assert.equal(scope.detail, 'Everything')
  assert.deepEqual(
    scope.groups[0].entries[0].options.map(option => option.label),
    ['Changes', 'Everything'],
  )
  const playback = model.groups[1].entries[3]
  assert.deepEqual(
    playback.groups.map(group => group.label),
    [undefined, 'Holds', 'Speed'],
  )
  assert.equal(playback.detail, '1×')
  // A one-choice submenu shows its value, and its choice isn't headed by the submenu's own name again.
  const highlighting = model.groups[1].entries[1]
  assert.equal(highlighting.detail, 'During the transition')
  assert.equal(highlighting.groups[0].label, undefined)
})

test('Playback is only offered animated, and Renderer only with a choice of renderers', () => {
  const sideBySide = settingsModel(projection({mode: 'side-by-side', renderers: [{name: 'graph', title: 'Graph'}]}), {}, showAs)
  assert.deepEqual(submenuLabels(sideBySide), ['Show', 'Highlight changes'])
})

test('the dependency graph’s option groups carry distinct labels (no repeated renderer name)', () => {
  const controls = [
    ...zoom,
    toggle('transitive', 'All packages', {group: 'packages', groupLabel: 'Packages'}),
    toggle('paths', 'Every dependency', {group: 'dependencies', groupLabel: 'Dependencies'}),
  ]
  const model = settingsModel(projection({controls}), {}, showAs)
  const options = model.groups.at(-1)
  assert.equal(options.label, 'Graph')
  assert.deepEqual(
    options.entries.map(entry => entry.label),
    ['Packages', 'Dependencies'],
  )
  for (const level of settingsLabels(model))
    assert.equal(new Set(level.map(label => label.toLowerCase())).size, level.length, level.join(', '))
})

test('renderer option groups get unique labels even when declarations repeat them or leave them out', () => {
  const controls = [
    toggle('a', 'A', {group: 'one', groupLabel: 'Detail'}),
    toggle('b', 'B', {group: 'two', groupLabel: 'Detail'}),
    toggle('c', 'C'),
    toggle('d', 'D'),
    toggle('e', 'Playback', {group: 'three'}),
  ]
  const model = settingsModel(projection({controls}), {zoom: false})
  const labels = settingsLabels(model)
  for (const level of labels) assert.equal(new Set(level.map(label => label.toLowerCase())).size, level.length, level.join(', '))
  // Beyond `maxRendererSubmenus` groups, one submenu holds them, each group headed by its label.
  const [options] = model.groups.at(-1).entries
  assert.equal(options.label, 'Graph options')
  assert.deepEqual(
    options.groups.map(group => group.label),
    ['Detail', 'Detail (2)', 'Graph options (2)', 'Playback (2)'],
  )
})

test('at the extremes the top level stays short enough for a 400px webview', () => {
  const many = Array.from({length: 30}, (_, index) => toggle(`t${index}`, `Toggle ${index}`, {group: `g${index}`}))
  const model = settingsModel(projection({controls: [...zoom, ...many]}), {}, showAs)
  const items = topItems(model)
  // Show as (3), Show (the scope), Highlight changes, Renderer, Playback and the renderer's options.
  assert.ok(items.length <= 3 + 1 + 3 + maxRendererSubmenus, `${items.length} items`)
  assert.equal(items.length, 8)
  // The most a top level holds: `maxRendererSubmenus` groups of their own. In 26px items, with two headings, three
  // separators and padding, it fits a 400px webview below a 36px toolbar.
  const most = settingsModel(projection({controls: many.slice(0, maxRendererSubmenus)}), {}, showAs)
  assert.equal(topItems(most).length, 3 + 1 + 3 + maxRendererSubmenus)
  assert.ok(topItems(most).length * 26 + 2 * 22 + 3 * 9 + 10 <= 400 - 36 - 16)
  // Ranges are offered too (a host opens them in a widget), inside their group.
  const ranged = settingsModel(
    projection({controls: [{id: 'depth', label: 'Depth', type: 'range', min: 1, max: 4, step: 1, default: 4, group: 'packing'}]}),
  )
  const [packing] = ranged.groups.at(-1).entries
  assert.equal(packing.label, 'Depth')
  assert.equal(packing.groups[0].entries[0].type, 'range')
})

test('nothing to set gives an empty model', () => {
  const model = settingsModel(projection({comparing: false, renderers: [{name: 'graph', title: 'Graph'}]}))
  assert.deepEqual(model.groups, [])
})
