import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  changesScope,
  comparisonModel,
  extractionModel,
  foldList,
  followContext,
  isFold,
  layoutFilter,
  partOwners,
  scopedModel,
} from '../dist/index.js'

const ids = items => items.map(entry => (entry.type === 'fold' ? `[${entry.items.join(' ')}]` : entry.item))

test('a list folds every run of two or more items the scope leaves out, and keeps a lone one', () => {
  const shown = new Set(['c', 'f'])
  assert.deepEqual(ids(foldList(['a', 'b', 'c', 'd', 'e', 'f', 'g'], id => id, shown)), ['[a b]', 'c', '[d e]', 'f', 'g'])
})

test('an expanded fold lists its items, and without a scope nothing folds', () => {
  const items = ['a', 'b', 'c', 'd']
  // An expanded run keeps its fold, open, before its items: the way to fold them again.
  const opened = foldList(items, id => id, new Set(['c']), new Set(['a']))
  assert.deepEqual(ids(opened), ['[a b]', 'a', 'b', 'c', 'd'])
  assert.equal(opened[0].open, true)
  assert.deepEqual(ids(foldList(items, id => id, undefined)), items)
})

const api = (entities, relationships = []) => ({protocolVersion: 0, schema: 'api/v0', entities, relationships})
const entity = id => ({id, kind: 'function', label: id})
const before = api([entity('tool'), entity('other')])
const after = api([entity('tool'), entity('tool/viewer'), entity('other')], [{id: 'c', kind: 'contains', from: 'tool', to: 'tool/viewer'}])
const comparison = {
  protocolVersion: 0,
  changes: [
    {id: 'tool/viewer', collection: 'entities', before: [], after: ['tool/viewer'], status: 'added', correspondence: 'none'},
    {id: 'c', collection: 'relationships', before: [], after: ['c'], status: 'added', correspondence: 'none'},
  ],
  steps: [{changes: ['tool/viewer', 'c']}],
}
const model = comparisonModel(before, after, comparison)

test("the Changes scope is the host's shown IDs, split into changes and context", () => {
  const scope = changesScope(model, {query: '', changesOnly: true, ids: ['tool', 'tool/viewer', 'c']})
  assert.deepEqual([...scope.changes].sort(), ['c', 'tool/viewer'])
  assert.deepEqual([...scope.context], ['tool'])
})

test("the summary filter and find narrow only what is at full strength: the host's `scope` is what is laid out", () => {
  const scope = changesScope(model, {query: '', changesOnly: true, ids: ['c'], scope: ['tool', 'tool/viewer', 'c']})
  assert.deepEqual([...scope.shown].sort(), ['c', 'tool', 'tool/viewer'])
  // Past the limit, the scope is derived again, whatever the matches.
  assert.deepEqual([...changesScope(model, {query: 'c', changesOnly: true, ids: ['c'], scope: null}).shown].sort(), [
    'c',
    'tool',
    'tool/viewer',
  ])
})

test('past the filter ID limit the kit derives the same scope, and there is none while every item shows', () => {
  const scope = changesScope(model, {query: '', changesOnly: true, ids: null})
  assert.deepEqual([...scope.shown].sort(), ['c', 'tool', 'tool/viewer'])
  assert.equal(changesScope(model, {query: '', changesOnly: false, ids: null}), undefined)
  assert.equal(changesScope(extractionModel(after), {query: '', changesOnly: true, ids: null}), undefined)
})

test("a split's further parts are in the scope with the change the host names", () => {
  const split = comparisonModel(api([entity('handler')]), api([entity('read'), entity('write')]), {
    protocolVersion: 0,
    changes: [
      {id: 'handler', collection: 'entities', before: ['handler'], after: ['read', 'write'], status: 'modified', correspondence: 'split'},
    ],
    steps: [{changes: ['handler']}],
  })
  assert.equal(split.entities.length, 2)
  const scope = changesScope(split, {query: '', changesOnly: true, ids: ['handler']})
  assert.deepEqual([...scope.shown].sort(), split.entities.map(row => row.id).sort())
  assert.deepEqual([...scope.changes].sort(), split.entities.map(row => row.id).sort())
})

// A schema: two tables with columns; `orders` gains a column and a key to `customers`; `audit` is unrelated.
const db = (entities, relationships) => ({protocolVersion: 0, schema: 'database/v0', entities, relationships})
const table = id => ({id, kind: 'table', label: id})
const column = id => ({id, kind: 'column', label: id.split('.')[1], data: {type: 'int'}})
const has = (from, to) => ({id: `${from}>${to}`, kind: 'contains', from, to})
const tables = ['orders', 'customers', 'audit'].map(table)
const columns = ['orders.id', 'orders.total', 'customers.id', 'customers.name', 'audit.id'].map(column)
const schemaBefore = db(
  [...tables, ...columns],
  columns.map(item => has(item.id.split('.')[0], item.id)),
)
const schemaAfter = db(
  [...tables, ...columns, column('orders.customer')],
  [
    ...columns.map(item => has(item.id.split('.')[0], item.id)),
    has('orders', 'orders.customer'),
    {id: 'fk', kind: 'relation', from: 'orders', to: 'customers'},
    {id: 'audit-link', kind: 'relation', from: 'audit', to: 'orders'},
  ],
)
const added = (id, collection) => ({id, collection, before: [], after: [id], status: 'added', correspondence: 'none'})
const schemaModel = comparisonModel(schemaBefore, schemaAfter, {
  protocolVersion: 0,
  changes: [
    added('orders.customer', 'entities'),
    added('orders>orders.customer', 'relationships'),
    added('fk', 'relationships'),
    added('audit-link', 'relationships'),
  ],
  steps: [{changes: ['orders.customer', 'orders>orders.customer', 'fk']}, {changes: ['audit-link']}],
})

test('a scoped model holds only what the scope shows, and never a relationship to an item it leaves out', () => {
  // The audit link is a change, but narrowed away (as a find would): its ends aren't shown, so it isn't kept.
  const shown = new Set(['orders.customer', 'orders>orders.customer', 'fk', 'orders', 'customers'])
  const {model} = scopedModel(schemaModel, shown)
  assert.deepEqual(model.entities.map(row => row.id).sort(), ['customers', 'orders', 'orders.customer'])
  const ids = new Set(model.entities.map(row => row.id))
  for (const row of model.relationships) {
    const item = row.after ?? row.before
    assert.ok(ids.has(item.from) && ids.has(item.to), `${row.id} has both ends shown`)
  }
  assert.deepEqual(model.relationships.map(row => row.id).sort(), ['fk', 'orders>orders.customer'])
  assert.deepEqual(model.after.entities.map(item => item.id).sort(), ['customers', 'orders', 'orders.customer'])
  // Steps keep their kept rows; one left with none is dropped.
  assert.deepEqual(
    model.steps.map(step => step.entities.length + step.relationships.length),
    [3],
  )
})

test('folded parts stand as one unchanged part of their entity, and opening a fold lists the parts it holds', () => {
  const shown = new Set(['orders.customer', 'orders>orders.customer', 'fk', 'orders', 'customers'])
  const {model, folds} = scopedModel(schemaModel, shown, 'fold')
  const fold = model.entities.find(row => row.id === 'pk-fold:orders')
  assert.ok(fold && isFold(fold.id))
  assert.equal(fold.after.label, '2 unchanged columns')
  assert.equal(fold.after.kind, 'column')
  assert.deepEqual([...folds.get('pk-fold:orders')].sort(), ['orders.id', 'orders.total'])
  assert.ok(model.after.relationships.some(item => item.from === 'orders' && item.to === 'pk-fold:orders'))
  // An open fold shows its parts and stays, as the way to fold them again.
  const open = scopedModel(schemaModel, shown, 'fold', new Set(['pk-fold:orders'])).model
  const hide = open.entities.find(row => row.id === 'pk-fold:orders')
  assert.equal(hide.after.label, 'Hide 2 unchanged columns')
  assert.deepEqual(hide.after.data, {open: true})
  assert.ok(open.entities.some(row => row.id === 'orders.total'))
  assert.ok(open.after.relationships.some(item => item.from === 'orders' && item.to === 'orders.total'))
  // Whole parts keep every column of a shown table instead.
  const whole = scopedModel(schemaModel, shown, 'whole').model
  assert.ok(whole.entities.some(row => row.id === 'customers.name'))
  assert.ok(!whole.entities.some(row => row.id === 'audit'))
})

test("a renderer's context follows the relationships it names: a changed package's path from the workspace", () => {
  const graph = (version, extra = []) => ({
    protocolVersion: 0,
    schema: 'graph/v0',
    entities: [
      {id: 'workspace', kind: 'workspace', label: 'workspace'},
      {id: 'a', kind: 'package', label: 'a'},
      {id: 'b', kind: 'package', label: 'b', data: {version}},
      {id: 'other', kind: 'package', label: 'other'},
      ...extra,
    ],
    relationships: [
      {id: 'workspace>a', kind: 'depends-on', from: 'workspace', to: 'a'},
      {id: 'a>b', kind: 'depends-on', from: 'a', to: 'b'},
      {id: 'workspace>other', kind: 'depends-on', from: 'workspace', to: 'other'},
    ],
  })
  const model = comparisonModel(graph('1'), graph('2'), {
    protocolVersion: 0,
    changes: [{id: 'b', collection: 'entities', before: ['b'], after: ['b'], status: 'modified', correspondence: 'exact'}],
    steps: [{changes: ['b']}],
  })
  assert.deepEqual([...followContext(model, new Set(['b']), {incoming: () => true})].sort(), ['a', 'a>b', 'workspace', 'workspace>a'])
  // Only the kinds named, and in the direction named.
  assert.deepEqual([...followContext(model, new Set(['b']), {outgoing: () => true})], [])
  assert.deepEqual([...followContext(model, new Set(['b']), {incoming: kind => kind === 'contains'})], [])
})

test('a summary figure or find lays nothing out again: the layout filter stays while the scope does', () => {
  const first = layoutFilter(undefined, {query: '', changesOnly: true, ids: null, scope: ['a', 'b']})
  assert.deepEqual(first, {query: '', changesOnly: true, ids: ['a', 'b'], scope: ['a', 'b']})
  assert.equal(layoutFilter(first, {query: 'a', changesOnly: true, ids: ['a'], scope: ['a', 'b']}), first)
  assert.notEqual(layoutFilter(first, {query: '', changesOnly: true, ids: null, scope: ['a']}), first)
  assert.notEqual(layoutFilter(first, {query: '', changesOnly: false, ids: null, scope: null}), first)
  // A host before `scope` sent the scope in `ids`: that is what is laid out.
  assert.deepEqual(layoutFilter(undefined, {query: '', changesOnly: true, ids: ['a']}).scope, ['a'])
})

test("a split's further parts are kept and receded with the change the host's filter names", () => {
  const split = comparisonModel(api([entity('handler')]), api([entity('read'), entity('write')]), {
    protocolVersion: 0,
    changes: [
      {id: 'handler', collection: 'entities', before: ['handler'], after: ['read', 'write'], status: 'modified', correspondence: 'split'},
    ],
    steps: [{changes: ['handler']}],
  })
  const owners = partOwners(split)
  const parts = split.changeRows.get('handler').filter(row => row !== 'handler')
  assert.ok(parts.length > 0)
  for (const part of parts) assert.equal(owners.get(part), 'handler')
  assert.equal(owners.has('handler'), false)
  assert.equal(partOwners(undefined).size, 0)
})
