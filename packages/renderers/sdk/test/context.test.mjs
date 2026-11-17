import {test} from 'node:test'
import assert from 'node:assert/strict'
import {changeContext, containmentKinds, presentComparison, scopeRows} from '../dist/presentation.js'

const entity = (id, kind = 'function') => ({id, kind, label: id})
const contains = (from, to) => ({id: `${from}>${to}`, kind: 'contains', from, to})
const api = (entities, relationships) => ({protocolVersion: 0, schema: 'api/v0', entities, relationships})

// Two tools with parameters, a third without; `view` gains a parameter and `serve` is renamed `listen`.
const before = api(
  [
    entity('tool:view'),
    entity('tool:view/id', 'property'),
    entity('tool:check'),
    entity('tool:check/path', 'property'),
    entity('tool:serve'),
  ],
  [contains('tool:view', 'tool:view/id'), contains('tool:check', 'tool:check/path')],
)
const after = api(
  [
    entity('tool:view'),
    entity('tool:view/id', 'property'),
    entity('tool:view/viewer', 'property'),
    entity('tool:check'),
    entity('tool:check/path', 'property'),
    entity('tool:listen'),
  ],
  [contains('tool:view', 'tool:view/id'), contains('tool:view', 'tool:view/viewer'), contains('tool:check', 'tool:check/path')],
)
const comparison = {
  protocolVersion: 0,
  changes: [
    {id: 'tool:view/viewer', collection: 'entities', before: [], after: ['tool:view/viewer'], status: 'added', correspondence: 'none'},
    {
      id: 'tool:view>tool:view/viewer',
      collection: 'relationships',
      before: [],
      after: ['tool:view>tool:view/viewer'],
      status: 'added',
      correspondence: 'none',
    },
    {
      id: 'tool:listen',
      collection: 'entities',
      before: ['tool:serve'],
      after: ['tool:listen'],
      status: 'unchanged',
      correspondence: 'declared',
    },
  ],
  steps: [{changes: ['tool:view/viewer', 'tool:view>tool:view/viewer']}, {changes: ['tool:listen']}],
}
const rows = scopeRows(presentComparison(before, after, comparison))

test('a change brings its container and a changed relationship its endpoints, as context', () => {
  const scope = changeContext(rows, {before, after})
  assert.deepEqual([...scope.changes].sort(), ['tool:listen', 'tool:view/viewer', 'tool:view>tool:view/viewer'])
  assert.deepEqual([...scope.context], ['tool:view'])
  assert.deepEqual([...scope.shown].sort(), ['tool:listen', 'tool:view', 'tool:view/viewer', 'tool:view>tool:view/viewer'])
})

test('narrowed changes bring only their own context', () => {
  const scope = changeContext(rows, {before, after}, ['tool:listen'])
  assert.deepEqual([...scope.shown], ['tool:listen'])
  assert.equal(scope.context.size, 0)
})

test('containment follows each revision, through every level, with the relationships that place it', () => {
  const nested = api(
    [entity('a', 'module'), entity('a/b', 'type'), entity('a/b/c', 'member')],
    [contains('a', 'a/b'), contains('a/b', 'a/b/c')],
  )
  const changed = api(
    nested.entities.map(item => (item.id === 'a/b/c' ? {...item, data: {signature: 'x'}} : item)),
    nested.relationships,
  )
  const scope = changeContext(
    scopeRows(
      presentComparison(nested, changed, {
        protocolVersion: 0,
        changes: [{id: 'a/b/c', collection: 'entities', before: ['a/b/c'], after: ['a/b/c'], status: 'modified', correspondence: 'exact'}],
        steps: [{changes: ['a/b/c']}],
      }),
    ),
    {before: nested, after: changed},
  )
  assert.deepEqual([...scope.context].sort(), ['a', 'a/b', 'a/b>a/b/c', 'a>a/b'])
})

test('containment kinds follow the domain schema and vocabularies', () => {
  assert.deepEqual([...containmentKinds({schema: 'graph/v0'})], ['contains'])
  assert.deepEqual([...containmentKinds({schema: 'database/v0'})].sort(), ['constraint', 'contains', 'index'])
  assert.deepEqual([...containmentKinds({schema: 'architecture/v0', vocabularies: ['dependency-injection/v0']})].sort(), [
    'contains',
    'implements',
    'registration',
  ])
})
