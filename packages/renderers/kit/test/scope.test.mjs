import {test} from 'node:test'
import assert from 'node:assert/strict'
import {changesScope, comparisonModel, extractionModel, foldList} from '../dist/index.js'

const ids = items => items.map(entry => (entry.type === 'fold' ? `[${entry.items.join(' ')}]` : entry.item))

test('a list folds every run of two or more items the scope leaves out, and keeps a lone one', () => {
  const shown = new Set(['c', 'f'])
  assert.deepEqual(ids(foldList(['a', 'b', 'c', 'd', 'e', 'f', 'g'], id => id, shown)), ['[a b]', 'c', '[d e]', 'f', 'g'])
})

test('an expanded fold lists its items, and without a scope nothing folds', () => {
  const items = ['a', 'b', 'c', 'd']
  assert.deepEqual(ids(foldList(items, id => id, new Set(['c']), new Set(['a']))), ['a', 'b', 'c', 'd'])
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

test('past the filter ID limit the kit derives the same scope, and there is none while every item shows', () => {
  const scope = changesScope(model, {query: '', changesOnly: true, ids: null})
  assert.deepEqual([...scope.shown].sort(), ['c', 'tool', 'tool/viewer'])
  assert.equal(changesScope(model, {query: '', changesOnly: false, ids: null}), undefined)
  assert.equal(changesScope(extractionModel(after), {query: '', changesOnly: true, ids: null}), undefined)
})
