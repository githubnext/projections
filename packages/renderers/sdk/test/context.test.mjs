import {test} from 'node:test'
import assert from 'node:assert/strict'
import {changeContext, isContainment, presentComparison, rowContexts, scopeRows} from '../dist/presentation.js'

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

test('containment follows the domain schema, and a vocabulary that names its structure by entity kinds', () => {
  const rel = (kind, from, to) => ({id: `${from}>${to}`, kind, from, to})
  const graph = isContainment({schema: 'graph/v0', entities: [], relationships: []})
  assert.equal(graph(rel('contains', 'a', 'b')), true)
  assert.equal(graph(rel('index', 'a', 'b')), false)
  assert.equal(isContainment({schema: 'database/v0', entities: [], relationships: []})(rel('index', 't', 'i')), true)
  // Dependency injection: service → registration → implementation, whatever the relationships' own kinds.
  const di = isContainment({
    schema: 'architecture/v0',
    vocabularies: ['dependency-injection/v0'],
    entities: [
      {id: 's', kind: 'service'},
      {id: 'r', kind: 'registration'},
      {id: 'i', kind: 'implementation'},
    ],
    relationships: [],
  })
  assert.equal(di(rel('registration', 's', 'r')), true)
  assert.equal(di(rel('implementation', 'r', 'i')), true)
  assert.equal(di(rel('dependsOn', 'i', 's')), false)
})

test("a comparison's own context is used, with the rules that added to it, and derivation fills only saved comparisons", () => {
  const withContext = {
    ...comparison,
    changes: comparison.changes.map(change =>
      change.id === 'tool:view/viewer'
        ? {...change, context: {before: [], after: ['tool:check', 'tool:view'], rules: ['siblings']}}
        : change,
    ),
  }
  const presented = presentComparison(before, after, withContext)
  assert.deepEqual(presented.entities.find(row => row.id === 'tool:view/viewer').context.rules, ['siblings'])
  const contextRows = scopeRows(presented)
  assert.deepEqual([...changeContext(contextRows, {before, after}).context].sort(), ['tool:check', 'tool:view'])
  const contextOf = rowContexts(contextRows, {before, after})
  assert.deepEqual(contextOf(contextRows.find(row => row.id === 'tool:view/viewer')), {
    rows: ['tool:check', 'tool:view'],
    rules: ['siblings'],
    derived: false,
  })
  // A change the comparison gives no context has none to derive, as the core gave it none.
  assert.deepEqual(contextOf(contextRows.find(row => row.id === 'tool:listen')), {rows: [], rules: [], derived: false})
  // Nor does one whose structure has context (the core's budget was spent): the comparison's context is the truth.
  assert.deepEqual(contextOf(contextRows.find(row => row.id === 'tool:view>tool:view/viewer')), {rows: [], rules: [], derived: false})
  // A saved comparison without context derives the core's: the container, and the relationship that places it there.
  assert.deepEqual(rowContexts(rows, {before, after})(rows.find(row => row.id === 'tool:view/viewer')), {
    rows: ['tool:view>tool:view/viewer', 'tool:view'],
    rules: [],
    derived: true,
  })
})

test("every part of a split carries the change's context", () => {
  const service = id => ({id, kind: 'service', label: id})
  const graph = entities => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships: []})
  const context = {before: ['gateway'], after: ['gateway'], rules: ['callers']}
  const presented = presentComparison(
    graph([service('billing'), service('gateway')]),
    graph([service('invoicing'), service('payments'), service('gateway')]),
    {
      protocolVersion: 0,
      steps: [{changes: ['invoicing']}],
      changes: [
        {
          id: 'invoicing',
          collection: 'entities',
          before: ['billing'],
          after: ['invoicing', 'payments'],
          status: 'modified',
          correspondence: 'split',
          context,
        },
      ],
    },
  )
  assert.deepEqual(
    presented.entities.filter(row => row.correspondence === 'split').map(row => [row.id, row.context]),
    [
      ['invoicing', context],
      ['payments', context],
    ],
  )
})

test("a shown relationship's endpoints are shown, though the context that names it doesn't name them", () => {
  const withRelationship = {
    ...comparison,
    changes: comparison.changes.map(change =>
      change.id === 'tool:listen' ? {...change, context: {before: [], after: ['tool:check>tool:check/path'], rules: ['paths']}} : change,
    ),
  }
  const contextRows = scopeRows(presentComparison(before, after, withRelationship))
  const scope = changeContext(contextRows, {before, after}, ['tool:listen'])
  assert.deepEqual([...scope.context].sort(), ['tool:check', 'tool:check/path', 'tool:check>tool:check/path'])
  // The change's own context stays as the comparison says.
  assert.deepEqual(rowContexts(contextRows, {before, after})(contextRows.find(row => row.id === 'tool:listen')).rows, [
    'tool:check>tool:check/path',
  ])
})

test('a shown entity brings the items containing it, though the context that names it skips them', () => {
  const withProperty = {
    ...comparison,
    changes: comparison.changes.map(change =>
      change.id === 'tool:listen' ? {...change, context: {before: [], after: ['tool:check/path'], rules: ['paths']}} : change,
    ),
  }
  const contextRows = scopeRows(presentComparison(before, after, withProperty))
  const scope = changeContext(contextRows, {before, after}, ['tool:listen'])
  assert.deepEqual([...scope.context].sort(), ['tool:check', 'tool:check/path', 'tool:check>tool:check/path'])
})

test('a containment relationship one revision brings has its endpoints in both', () => {
  const node = id => ({id, kind: 'module', label: id})
  const graph = relationships => ({
    protocolVersion: 0,
    schema: 'graph/v0',
    entities: ['p', 'q', 'other', 'leaf', 'x'].map(node),
    relationships,
  })
  // `r` moves from q → other to p → leaf; a rule gives `x` the context `leaf`.
  const old = graph([{id: 'r', kind: 'contains', from: 'q', to: 'other'}])
  const current = graph([{id: 'r', kind: 'contains', from: 'p', to: 'leaf'}])
  const contextRows = scopeRows(
    presentComparison(
      old,
      {...current, entities: current.entities.map(item => (item.id === 'x' ? {...item, label: 'X'} : item))},
      {
        protocolVersion: 0,
        changes: [
          {
            id: 'x',
            collection: 'entities',
            before: ['x'],
            after: ['x'],
            status: 'modified',
            correspondence: 'exact',
            context: {before: [], after: ['leaf']},
          },
          {id: 'r', collection: 'relationships', before: ['r'], after: ['r'], status: 'modified', correspondence: 'exact'},
        ],
        steps: [{changes: ['x', 'r']}],
      },
    ),
  )
  const scope = changeContext(contextRows, {before: old, after: current}, ['x'])
  assert.deepEqual([...scope.context].sort(), ['leaf', 'other', 'p', 'q', 'r'])
})
