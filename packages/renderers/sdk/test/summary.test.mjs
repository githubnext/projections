import {test} from 'node:test'
import assert from 'node:assert/strict'
import {humanizeKind, kindWords, pluralWord, sentenceCase, summaryCounts, summaryItems, summarySentence} from '../dist/presentation.js'
import {parseSummaryItems, rendererLimits} from '../dist/protocol.js'

const entity = (id, kind) => ({id, kind, label: id})
const relationship = (id, kind, from, to) => ({id, kind, from, to})
const extraction = (entities, relationships = []) => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships})
const change = (id, status, collection, before, after) => ({id, status, collection, correspondence: 'exact', before, after})

test('kinds read as nouns: words from camel, kebab and snake case, with simple English plurals', () => {
  const cases = {
    workspace: ['workspace', 'workspaces'],
    'depends-on': ['dependency', 'dependencies'],
    dependsOn: ['dependency', 'dependencies'],
    dependencies: ['dependency', 'dependencies'],
    devDependencies: ['dev dependency', 'dev dependencies'],
    'external-package': ['external package', 'external packages'],
    target_framework: ['target framework', 'target frameworks'],
    policy: ['policy', 'policies'],
    'primary-key': ['primary key', 'primary keys'],
    class: ['class', 'classes'],
    index: ['index', 'indexes'],
    analysis: ['analysis', 'analyses'],
    status: ['status', 'statuses'],
    imports: ['import', 'imports'],
    calls: ['call', 'calls'],
    matches: ['match', 'matches'],
    classes: ['class', 'classes'],
    'applies-to': ['applies to', 'applies to'],
    'many-to-many': ['many to many', 'many to many'],
    'data-source': ['data source', 'data sources'],
    HTTPRoute: ['HTTPRoute', 'HTTPRoutes'],
    hidden: ['hidden', 'hidden'],
    'not-patchable': ['not patchable', 'not patchable'],
    deprecated: ['deprecated', 'deprecated'],
    'pre-release': ['pre-release', 'pre-releases'],
    'self-hosted': ['self-hosted', 'self-hosted'],
    secret: ['secret', 'secrets'],
    variable: ['variable', 'variables'],
    embed: ['embed', 'embeds'],
    seed: ['seed', 'seeds'],
    'read-only': ['read only', 'read only'],
  }
  for (const [kind, [singular, plural]] of Object.entries(cases)) assert.deepEqual(humanizeKind(kind), {singular, plural}, kind)
  assert.deepEqual(kindWords('devDependencies'), ['dev', 'dependencies'])
  assert.equal(pluralWord('key'), 'keys')
  assert.equal(pluralWord('box'), 'boxes')
})

const before = extraction(
  [entity('a', 'workspace'), entity('b', 'workspace'), entity('old', 'workspace'), entity('lib', 'package')],
  [relationship('a-lib', 'depends-on', 'a', 'lib'), relationship('b-lib', 'depends-on', 'b', 'lib')],
)
const after = extraction(
  [entity('a', 'workspace'), entity('b', 'workspace'), entity('new', 'workspace'), entity('lib', 'package')],
  [
    relationship('a-lib', 'depends-on', 'a', 'lib'),
    relationship('b-lib', 'depends-on', 'b', 'lib'),
    relationship('new-lib', 'depends-on', 'new', 'lib'),
  ],
)
const comparison = {
  protocolVersion: 0,
  changes: [
    change('c1', 'removed', 'entities', ['old'], []),
    change('c2', 'added', 'entities', [], ['new']),
    change('c3', 'added', 'relationships', [], ['new-lib']),
    change('c4', 'modified', 'entities', ['lib'], ['lib']),
    change('c5', 'unchanged', 'entities', ['a'], ['a']),
  ],
  steps: [{changes: ['c1', 'c2', 'c3', 'c4']}],
}

test('one extraction counts its items per kind: entity kinds, then relationship kinds, largest first', () => {
  assert.deepEqual(summaryCounts({mode: 'extraction', extraction: before}), [
    {collection: 'entities', kind: 'workspace', count: 3},
    {collection: 'entities', kind: 'package', count: 1},
    {collection: 'relationships', kind: 'depends-on', count: 2},
  ])
})

test('a comparison counts the after revision and the changes per kind, by the item each change names', () => {
  assert.deepEqual(summaryCounts({mode: 'comparison', before, after, comparison}), [
    {collection: 'entities', kind: 'workspace', count: 3, removed: 1, added: 1},
    {collection: 'entities', kind: 'package', count: 1, modified: 1},
    {collection: 'relationships', kind: 'depends-on', count: 3, added: 1},
  ])
  // A kind only the before revision has is counted with a total of 0.
  const gone = {
    ...comparison,
    changes: [change('c1', 'removed', 'entities', ['old'], [])],
  }
  const without = extraction(after.entities.filter(item => item.id !== 'new'))
  assert.deepEqual(
    summaryCounts({mode: 'comparison', before: extraction([entity('old', 'legacy')]), after: without, comparison: gone}).find(
      item => item.kind === 'legacy',
    ),
    {collection: 'entities', kind: 'legacy', count: 0, removed: 1},
  )
})

test('summary items word each kind with the renderer nouns first, in their order, and leave out kinds mapped to false', () => {
  const subject = {mode: 'comparison', before, after, comparison}
  const items = summaryItems(subject, {
    'depends-on': {singular: 'dependency', plural: 'dependencies'},
    workspace: {singular: 'workspace', plural: 'workspaces'},
    package: false,
  })
  assert.deepEqual(items, [
    {
      type: 'count',
      collection: 'relationships',
      kind: 'depends-on',
      count: 3,
      added: 1,
      noun: {singular: 'dependency', plural: 'dependencies'},
    },
    {
      type: 'count',
      collection: 'entities',
      kind: 'workspace',
      count: 3,
      removed: 1,
      added: 1,
      noun: {singular: 'workspace', plural: 'workspaces'},
    },
  ])
  assert.deepEqual(parseSummaryItems(items), items)
  // Without nouns, the host's words.
  assert.deepEqual(
    summaryItems({mode: 'extraction', extraction: before}).map(item => item.noun.plural),
    ['workspaces', 'packages', 'dependencies'],
  )
  // A function keeps the host's words where it returns undefined.
  assert.deepEqual(
    summaryItems({mode: 'extraction', extraction: before}, (kind, collection) =>
      kind === 'workspace' && collection === 'entities' ? {singular: 'member', plural: 'members'} : undefined,
    ).map(item => item.noun.plural),
    ['members', 'packages', 'dependencies'],
  )
  assert.deepEqual(
    summaryItems({mode: 'extraction', extraction: before}, kind =>
      kind === 'workspace' ? {singular: 'member', plural: 'members'} : undefined,
    ).map(item => item.noun.plural),
    ['members', 'packages', 'dependencies'],
  )
  // A kind both collections use is two figures; a collection's own key wins over the bare kind.
  const both = extraction([entity('i', 'index')], [relationship('r', 'index', 'i', 'i')])
  assert.deepEqual(
    summaryItems({mode: 'extraction', extraction: both}, {index: {singular: 'index', plural: 'indexes'}, 'relationships:index': false}),
    [{type: 'count', collection: 'entities', kind: 'index', count: 1, noun: {singular: 'index', plural: 'indexes'}}],
  )
  assert.equal(summaryItems({mode: 'extraction', extraction: both}).length, 2)
  // Bounded to the protocol's limit.
  const many = extraction(Array.from({length: rendererLimits.summaryItems + 5}, (_, index) => entity(`e${index}`, `kind-${index}`)))
  assert.equal(summaryItems({mode: 'extraction', extraction: many}).length, rendererLimits.summaryItems)
})

test('the summary sentence: totals, then the changes that happened', () => {
  const workspaces = {singular: 'workspace', plural: 'workspaces'}
  const dependencies = {singular: 'dependency', plural: 'dependencies'}
  assert.equal(
    summarySentence([
      {noun: workspaces, count: 12},
      {noun: dependencies, count: 1},
    ]),
    '12 workspaces · 1 dependency',
  )
  assert.equal(
    summarySentence(
      [
        {noun: workspaces, count: 12, added: 1, removed: 1},
        {noun: dependencies, count: 18, added: 2, modified: 0},
      ],
      'en-US',
    ),
    '12 workspaces +1 \u22121 · 18 dependencies +2',
  )
  assert.equal(summarySentence([{noun: workspaces, count: 1200, modified: 3}], 'en-US'), '1,200 workspaces ~3')
})

test('sentence case capitalizes a label, but not a name written in lowercase', () => {
  assert.equal(sentenceCase('rust crates'), 'Rust crates')
  assert.equal(sentenceCase('npm packages'), 'npm packages')
  assert.equal(sentenceCase('pnpm'), 'pnpm')
  assert.equal(sentenceCase('npmrc files'), 'Npmrc files')
  assert.equal(sentenceCase(''), '')
})
