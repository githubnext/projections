import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  createFrame,
  entityQuantity,
  initialViewerState,
  quantityAt,
  quantityDomains,
  quantityGeometry,
  quantityShares,
  statisticsRows,
  sumQuantities,
  viewerReducer,
} from '../dist/index.js'

const metric = (id, value, unit, defined = true) => ({id, kind: 'metric', label: id, data: {value, unit, defined}})
const change = (a, b) => ({id: a?.id ?? b.id, ...(a ? {before: a} : {}), ...(b ? {after: b} : {}), status: 'modified'})

test('quantity scales span both revisions per exact unit, not one full bar per entity', () => {
  const changes = [
    change(metric('large', 100, 'ms'), metric('large', 200, 'ms')),
    change(metric('small', 25, 'ms'), metric('small', 50, 'ms')),
    change(metric('seconds', 2, 's'), metric('seconds', 4, 's')),
    change(metric('unknown', 9999, 'ms', false), metric('unknown', 9999, 'ms', false)),
  ]
  const domains = quantityDomains(changes.flatMap(item => [entityQuantity(item.before), entityQuantity(item.after)]))
  assert.deepEqual(domains.get('ms'), {min: 0, max: 200})
  assert.deepEqual(domains.get('s'), {min: 0, max: 4})
  assert.equal(quantityGeometry(quantityAt(changes[1], 0).value, domains.get('ms')).width, 0.125)
  assert.equal(quantityGeometry(quantityAt(changes[1], 1).value, domains.get('ms')).width, 0.25)
  assert.equal(quantityGeometry(quantityAt(changes[0], 1).value, domains.get('ms')).width, 1)
  for (let i = 0; i <= 100; i++) {
    assert.equal(quantityAt(changes[0], i / 100).value, 100 * (1 - i / 100) + (200 * i) / 100)
  }
})

test('signed scales use the full domain, retain zero and avoid overflow for finite extremes', () => {
  const positive = quantityGeometry(40, {min: -20, max: 80})
  assert.equal(positive.zero, 0.2)
  assert.equal(positive.left, 0.2)
  assert.ok(Math.abs(positive.width - 0.4) < 1e-12)
  assert.deepEqual(quantityGeometry(-20, {min: -20, max: 80}), {zero: 0.2, left: 0, width: 0.2})
  assert.deepEqual(quantityGeometry(-200, {min: -200, max: 0}), {zero: 1, left: 0, width: 1})
  assert.deepEqual(quantityGeometry(0, {min: 0, max: 0}), {zero: 0, left: 0, width: 0})
  assert.deepEqual(quantityGeometry(Number.MAX_VALUE, {min: -Number.MAX_VALUE, max: Number.MAX_VALUE}), {zero: 0.5, left: 0.5, width: 0.5})
})

test('unit changes and missing values never become fabricated interpolated quantities', () => {
  const switched = change(metric('time', 1000, 'ms'), metric('time', 2, 's'))
  assert.deepEqual(quantityAt(switched, 0.49), {unit: 'ms', value: 1000})
  assert.deepEqual(quantityAt(switched, 0.5), {unit: 's', value: 2})
  const unknown = change(metric('value', 20, 'ms'), metric('value', 99, 'ms', false))
  assert.equal(quantityAt(unknown, 0.49).value, 20)
  assert.equal(quantityAt(unknown, 0.5).value, undefined)
  assert.equal(entityQuantity({id: 'missing', kind: 'metric', data: {unit: 'ms'}}).value, undefined)
  assert.equal(entityQuantity(metric('zero', 0, 'ms')).value, 0)
  assert.equal(entityQuantity(metric('nonfinite', Infinity, 'ms')).value, undefined)
})

test('statistics options remain one headless state across grouping and other viewer actions', () => {
  let state = viewerReducer(initialViewerState(), {type: 'statistics', value: {measure: 'files', chart: 'share'}})
  state = viewerReducer(state, {type: 'statistics', value: {byLanguage: false}})
  assert.deepEqual(state.statistics, {measure: 'files', chart: 'share', byLanguage: false, scope: 'all'})
  for (const action of [
    {type: 'presentation', value: 'table'},
    {type: 'seek', value: 0.3},
    {type: 'select', id: 'x'},
  ]) {
    state = viewerReducer(state, action)
    assert.equal(state.statistics.measure, 'files')
  }
  state = viewerReducer(state, {type: 'statistics', value: {byLanguage: true}})
  assert.equal(state.statistics.measure, 'files')
})

test('statistics pivots aggregate collected measures without semantic rematching or unknown-as-zero', () => {
  const languages = [
    {id: 'ts', label: 'TypeScript', kind: 'language', data: {files: 10, code: 100, comment: 20, blank: 10, lines: 130}},
    {id: 'js', label: 'JavaScript', kind: 'language', data: {files: 2, code: 20, comment: 5, blank: 5, lines: 30}},
  ]
  const snapshot = {protocolVersion: 0, schema: 'metrics/v0', entities: languages, relationships: []}
  const frame = createFrame(snapshot)
  const options = {measure: 'files', byLanguage: true, chart: 'bars'}
  assert.deepEqual(
    statisticsRows(frame, options).map(row => [row.value, row.unit]),
    [
      [10, 'files'],
      [2, 'files'],
    ],
  )
  const composition = statisticsRows(frame, {...options, byLanguage: false})
  assert.deepEqual(
    composition.map(row => row.value),
    [120, 25, 15],
  )
  assert.equal(sumQuantities(composition.map(row => row.value)), 160)
  assert.ok(composition.every(row => !row.node && row.unit === 'lines'))
  const missing = createFrame({...snapshot, entities: [{...languages[0], data: {files: 10}}]})
  assert.equal(statisticsRows(missing, {...options, measure: 'blank'})[0].value, undefined)
  assert.equal(statisticsRows(missing, {...options, byLanguage: false})[0].value, undefined)
  assert.equal(quantityShares([20, undefined]), undefined)
  assert.equal(quantityShares([20, -1]), undefined)
  assert.deepEqual(quantityShares([0, 0]), [0, 0])
  assert.deepEqual(quantityShares([1, 3]), [0.25, 0.75])
  assert.deepEqual(quantityShares([Number.MAX_VALUE, Number.MAX_VALUE]), [0.5, 0.5])
})

test('statistics contributions, totals and shares use the same staged presence while seeking either direction', () => {
  const removed = {id: 'old', kind: 'language', data: {files: 4}}
  const added = {id: 'new', kind: 'language', data: {files: 8}}
  const comparison = {
    entities: [
      {id: 'old', before: removed, status: 'removed'},
      {id: 'new', after: added, status: 'added'},
    ],
    relationships: [],
  }
  const after = {protocolVersion: 0, schema: 'metrics/v0', entities: [added], relationships: []}
  const options = {measure: 'files', byLanguage: true, chart: 'share'}
  for (let i = 0; i <= 100; i++) {
    const frame = createFrame(after, comparison, i / 100)
    const rows = statisticsRows(frame, options)
    assert.deepEqual(rows, statisticsRows(createFrame(after, comparison, i / 100), options))
    for (const row of rows) assert.equal(row.value, (row.id === 'old' ? 4 : 8) * row.opacity)
    const shares = quantityShares(rows.map(row => row.value))
    if (rows.length) assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 1e-10)
  }
})
