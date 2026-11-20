import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {parseControls} from '@githubnext/projections-renderer-sdk/protocol'
import {nextSort, parseTableSort, sortTableRows, tableSortControls, tableSortOf, tableSortValue} from '../dist/index.js'
import {DataTable} from '../dist/react.js'

const columns = [
  {id: 'name', label: 'Name', value: item => item.name},
  {id: 'lines', label: 'Lines', value: item => item.lines, sort: 'number'},
  {id: 'owner', label: 'Owner', value: item => item.owner},
]
const unchanged = (id, item) => ({id, before: item, after: item, status: 'unchanged'})
const rows = [
  unchanged('b', {name: 'beta', lines: 30, owner: 'x'}),
  {id: 'r', before: {name: 'gone', lines: 50, owner: 'y'}, status: 'removed'},
  {id: 'a', after: {name: 'alpha', lines: 10, owner: 'x'}, status: 'added'},
  {id: 'm', before: {name: 'mid', lines: 5, owner: 'y'}, after: {name: 'mid', lines: 40, owner: 'y'}, status: 'modified'},
  unchanged('n', {name: 'none', owner: 'z'}),
]
const ids = list => list.map(row => row.id)

test('a comparison sorts by After, Before for a removed row, with missing values last either way', () => {
  assert.deepEqual(ids(sortTableRows(rows, columns, {column: 'lines', direction: 'ascending'})), ['a', 'b', 'm', 'r', 'n'])
  assert.deepEqual(ids(sortTableRows(rows, columns, {column: 'lines', direction: 'descending'})), ['r', 'm', 'b', 'a', 'n'])
})

test('ties break by the row label, then the ID, and an unsorted table keeps its order', () => {
  const tied = [unchanged('2', {name: 'b', owner: 'x'}), unchanged('3', {name: 'a', owner: 'x'}), unchanged('1', {name: 'a', owner: 'x'})]
  assert.deepEqual(ids(sortTableRows(tied, columns, {column: 'owner', direction: 'descending'})), ['1', '3', '2'])
  assert.deepEqual(ids(sortTableRows(rows, columns, null)), ids(rows))
  assert.deepEqual(ids(sortTableRows(rows, columns, {column: 'unknown', direction: 'ascending'})), ids(rows))
})

test('strings sort naturally, and changes first keeps each part in the sort order', () => {
  const versions = ['v10', 'v2', 'V1'].map(name => unchanged(name, {name}))
  assert.deepEqual(ids(sortTableRows(versions, columns, {column: 'name', direction: 'ascending'})), ['V1', 'v2', 'v10'])
  assert.deepEqual(ids(sortTableRows(rows, columns, {column: 'name', direction: 'ascending'}, {changesFirst: true})), [
    'a',
    'r',
    'm',
    'b',
    'n',
  ])
})

test('a column with a comparison sorts by it; an unsortable one keeps the order', () => {
  const byOwnerThenName = {id: 'custom', label: 'Custom', sort: (x, y) => x.owner.localeCompare(y.owner)}
  assert.deepEqual(ids(sortTableRows(rows, [...columns, byOwnerThenName], {column: 'custom', direction: 'ascending'})), [
    'a',
    'b',
    'r',
    'm',
    'n',
  ])
  const fixed = [{...columns[0], sort: false}]
  assert.deepEqual(ids(sortTableRows(rows, fixed, {column: 'name', direction: 'ascending'})), ids(rows))
})

test('a heading flips its own sort and starts another column in its first direction', () => {
  const lines = {...columns[1], firstDirection: 'descending'}
  assert.deepEqual(nextSort(null, lines), {column: 'lines', direction: 'descending'})
  assert.deepEqual(nextSort({column: 'lines', direction: 'descending'}, lines), {column: 'lines', direction: 'ascending'})
  assert.deepEqual(nextSort({column: 'lines', direction: 'descending'}, columns[0]), {column: 'name', direction: 'ascending'})
})

test('the sort controls are valid declarations whose values round-trip', () => {
  const controls = tableSortControls({columns, default: {column: 'lines', direction: 'descending'}})
  assert.deepEqual(parseControls(controls), controls)
  assert.deepEqual(
    controls.map(control => control.id),
    ['sort', 'sortChangesFirst'],
  )
  assert.equal(controls[0].default, 'lines:descending')
  assert.equal(controls[0].choices.length, 1 + 2 * columns.length)
  assert.deepEqual(tableSortOf({sort: 'lines:descending', sortChangesFirst: true}), {
    sort: {column: 'lines', direction: 'descending'},
    changesFirst: true,
  })
  for (const sort of [null, {column: 'a.b-c', direction: 'ascending'}]) assert.deepEqual(parseTableSort(tableSortValue(sort)), sort)
  for (const value of ['none', 'lines', ':ascending', 'lines:up', 7]) assert.equal(parseTableSort(value), null)
  assert.throws(() => tableSortControls({columns: [{id: 'has space', label: 'X', value: () => 1}]}))
})

const table = props =>
  renderToStaticMarkup(createElement(DataTable, {label: 'Files', columns, rows, comparing: true, onSortChange: () => {}, ...props}))

test('the table is a labelled table whose sorted heading says its direction', () => {
  const markup = table({sort: {column: 'lines', direction: 'descending'}})
  assert.match(markup, /role="table" aria-label="Files"/)
  assert.equal(markup.match(/aria-sort="descending"/g)?.length, 1)
  assert.match(
    markup,
    /role="columnheader"[^>]*aria-sort="descending"[^>]*><button type="button" class="pk-table-sort"><span class="pk-table-text">Lines/,
  )
  assert.equal(markup.match(/role="rowheader"/g)?.length, rows.length)
})

test('the diff draws a changed cell as was and now, and marks only the innermost changes', () => {
  const markup = table({diff: true, emphasis: () => 1})
  const modified = markup.slice(markup.indexOf('data-entity-id="m"'), markup.indexOf('data-entity-id="n"'))
  assert.match(modified, /<del class="pk-change-pill" data-change="removed"><span class="sr-only">was <\/span>5<\/del>/)
  assert.match(modified, /<ins class="pk-change-pill" data-change="added"><span class="sr-only">, now <\/span>40<\/ins>/)
  const removed = markup.slice(markup.indexOf('data-entity-id="r"'), markup.indexOf('data-entity-id="a"'))
  assert.match(removed, /pk-region/)
  assert.doesNotMatch(removed, /pk-change-pill/)
  assert.match(removed, /pk-diff-text/)
})

test('the Changes scope folds each run of unshown rows, in the sorted order', () => {
  const markup = table({
    diff: true,
    emphasis: () => 1,
    sort: {column: 'lines', direction: 'ascending'},
    scope: {shown: new Set(['a', 'r'])},
    noun: 'files',
  })
  // Sorted a, b, m, r, n: b and m fold between a and r; n alone stays a row.
  assert.deepEqual(
    [...markup.matchAll(/data-entity-id="(\w)"|"pk-fold-label">(\d) unchanged files/g)].map(match => match[1] ?? `fold ${match[2]}`),
    ['a', 'fold 2', 'r', 'n'],
  )
  assert.match(markup, /role="row" class="pk-table-row pk-table-fold"><div role="cell" class="pk-table-fold-cell">/)
})

test('an unchanged row whose values vary within tolerance draws no change', () => {
  const varied = {id: 'v', before: {name: 'v', lines: 10, owner: 'x'}, after: {name: 'v', lines: 11, owner: 'x'}, status: 'unchanged'}
  const markup = renderToStaticMarkup(
    createElement(DataTable, {label: 'Files', columns, rows: [varied], comparing: true, diff: true, emphasis: () => 1}),
  )
  assert.doesNotMatch(markup, /pk-change-pill|data-change=/)
})

test('a value only one version has is one pill, and a changed cell reserves both widths', () => {
  const grown = {id: 'g', before: {name: 'g', owner: 'x'}, after: {name: 'g', lines: 1000000, owner: 'x'}, status: 'modified'}
  const diff = renderToStaticMarkup(
    createElement(DataTable, {label: 'Files', columns, rows: [grown], comparing: true, diff: true, emphasis: () => 1}),
  )
  assert.doesNotMatch(diff, /<del/)
  assert.match(diff, /<ins class="pk-change-pill" data-change="added"><span class="sr-only">now <\/span>1,000,000<\/ins>/)
  const shrunk = {...grown, before: grown.after, after: {name: 'g', lines: 1, owner: 'x'}}
  const moving = renderToStaticMarkup(
    createElement(DataTable, {label: 'Files', columns, rows: [shrunk], comparing: true, progress: 0.8, emphasis: () => 0}),
  )
  assert.match(
    moving,
    /<span class="pk-table-reserve"><span class="pk-table-text">1<\/span><span class="pk-table-reserve-other" aria-hidden="true">1,000,000<\/span><\/span>/,
  )
})

test('the progress modes show the version reached and nothing changed at the endpoints', () => {
  const before = table({progress: 0, emphasis: () => 0})
  assert.doesNotMatch(before, /data-change="/)
  assert.match(before, /data-entity-id="a"[^>]*inert=""[^>]*aria-hidden="true" style="--emphasis:0;opacity:0"/)
  assert.doesNotMatch(before, /data-entity-id="b"[^>]*inert/)
  const moving = table({progress: 0.7, emphasis: row => (row.status === 'unchanged' ? 0 : 0.5)})
  const modified = moving.slice(moving.indexOf('data-entity-id="m"'), moving.indexOf('data-entity-id="n"'))
  assert.match(modified, /class="pk-change-pill pk-table-value" data-change="added"><span class="sr-only">now <\/span>40/)
  const settled = table({progress: 1, emphasis: () => 0})
  assert.doesNotMatch(settled, /pk-change-pill/)
})
