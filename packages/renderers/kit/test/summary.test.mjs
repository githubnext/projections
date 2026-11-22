import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {parseRendererMessage, rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import {rendererSummary, summaryChange} from '../dist/index.js'

const valid = summary => parseRendererMessage({projections: 0, channel: 'c', type: 'summary', ...summary}, 'c')
const extraction = (entities, relationships = []) => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships})
const base = {
  projection: {id: 'p', title: 'P', renderer: 'graph'},
  theme: {colorMode: 'light', tokens: {}},
  reducedMotion: false,
  locale: 'en',
}
const before = extraction(
  [
    {id: 'a', kind: 'service'},
    {id: 'b', kind: 'service'},
  ],
  [{id: 'ab', kind: 'calls', from: 'a', to: 'b'}],
)
const after = extraction(
  [
    {id: 'a', kind: 'service'},
    {id: 'c', kind: 'cache'},
  ],
  [{id: 'ac', kind: 'calls', from: 'a', to: 'c'}],
)
const comparison = {
  protocolVersion: 0,
  changes: [
    {id: 'x1', status: 'removed', collection: 'entities', correspondence: 'exact', before: ['b'], after: []},
    {id: 'x2', status: 'added', collection: 'entities', correspondence: 'exact', before: [], after: ['c']},
    {id: 'x3', status: 'removed', collection: 'relationships', correspondence: 'exact', before: ['ab'], after: []},
    {id: 'x4', status: 'added', collection: 'relationships', correspondence: 'exact', before: [], after: ['ac']},
  ],
  steps: [{changes: ['x1', 'x2', 'x3', 'x4']}],
}

test('a kit renderer summarizes every kind with the counts the host checks, in the host words without nouns', () => {
  const summary = rendererSummary({...base, mode: 'extraction', extraction: before})
  assert.deepEqual(summary, {
    items: [
      {type: 'count', collection: 'entities', kind: 'service', count: 2, noun: {singular: 'service', plural: 'services'}},
      {type: 'count', collection: 'relationships', kind: 'calls', count: 1, noun: {singular: 'call', plural: 'calls'}},
    ],
  })
  assert.deepEqual(valid(summary), {type: 'summary', ...summary})
})

test('the renderer nouns word its kinds and order them; a comparison adds its changes per kind', () => {
  const summary = rendererSummary(
    {...base, mode: 'comparison', before, after, comparison},
    {calls: {singular: 'call site', plural: 'call sites'}, cache: false},
  )
  assert.deepEqual(summary.items, [
    {
      type: 'count',
      collection: 'relationships',
      kind: 'calls',
      count: 1,
      removed: 1,
      added: 1,
      noun: {singular: 'call site', plural: 'call sites'},
    },
    {type: 'count', collection: 'entities', kind: 'service', count: 1, removed: 1, noun: {singular: 'service', plural: 'services'}},
  ])
  assert.ok(valid(summary))
})

test("a renderer's facts follow its kind counts, within the protocol's bounds", () => {
  const noun = {singular: 'breaking change', plural: 'breaking changes'}
  const fact = {type: 'fact', id: 'breaking', icon: 'breaking', count: 1, noun, ids: ['x1']}
  const summary = rendererSummary({...base, mode: 'comparison', before, after, comparison}, {cache: false}, [fact])
  assert.deepEqual(
    summary.items.map(item => (item.type === 'fact' ? `fact:${item.id}` : item.kind)),
    ['service', 'calls', 'fact:breaking'],
  )
  assert.ok(valid(summary))
  // Facts keep their place: the kind counts give way when together they would outnumber the protocol's figures.
  const many = Array.from({length: rendererLimits.summaryItems}, (_, index) => ({type: 'fact', id: `f${index}`, count: index, noun}))
  const full = rendererSummary({...base, mode: 'extraction', extraction: before}, undefined, many)
  assert.equal(full.items.length, rendererLimits.summaryItems)
  assert.ok(full.items.every(item => item.type === 'fact'))
  assert.ok(valid(full))
  // A fact naming more items than a filter takes, or more than a message holds, is still stated, without its filter.
  const wide = {...fact, ids: Array.from({length: rendererLimits.summaryFactIds + 1}, (_, index) => `item-${index}`)}
  assert.deepEqual(rendererSummary({...base, mode: 'extraction', extraction: before}, undefined, [wide]).items.at(-1), {
    type: 'fact',
    id: 'breaking',
    icon: 'breaking',
    count: 1,
    noun,
  })
  const long = id => ({type: 'fact', id, count: 1, noun, ids: Array.from({length: 900}, (_, index) => `${id}-${'x'.repeat(40)}-${index}`)})
  const bounded = rendererSummary({...base, mode: 'extraction', extraction: before}, undefined, [long('a'), long('b')])
  assert.ok(valid(bounded), 'the summary fits one message')
  assert.equal(bounded.items.filter(item => item.ids).length, 1, 'one fact gives up its filter, the other keeps it')
})

test('a measure of each revision changes by its net difference', () => {
  assert.deepEqual(summaryChange(37826, 39882), {added: 2056})
  assert.deepEqual(summaryChange(3, 2), {removed: 1})
  assert.deepEqual(summaryChange(2, 2), {})
  assert.deepEqual(summaryChange(undefined, 9), {})
})

test("the definition's nouns (presentation.kinds) word its kinds over the renderer's, keeping the renderer's kinds and order", () => {
  const kinds = {
    cache: {noun: {singular: 'cache tier', plural: 'cache tiers'}},
    service: {color: 'danger'},
    calls: {noun: {singular: 'request', plural: 'requests'}},
  }
  const subject = {...base, projection: {...base.projection, kinds}, mode: 'extraction', extraction: after}
  const nouns = (summary, kind) => summary.items.find(item => item.kind === kind)?.noun
  const plain = rendererSummary(subject, {calls: {singular: 'call site', plural: 'call sites'}})
  assert.deepEqual(nouns(plain, 'cache'), {singular: 'cache tier', plural: 'cache tiers'})
  assert.deepEqual(nouns(plain, 'calls'), {singular: 'request', plural: 'requests'})
  assert.deepEqual(nouns(plain, 'service'), {singular: 'service', plural: 'services'}, 'a kind with only a color keeps the host words')
  assert.deepEqual(
    plain.items.map(item => item.kind),
    rendererSummary({...subject, projection: base.projection}, {calls: {singular: 'call site', plural: 'call sites'}}).items.map(
      item => item.kind,
    ),
    'the order is the renderer’s',
  )
  assert.equal(nouns(rendererSummary(subject, {cache: false}), 'cache'), undefined, 'a kind the renderer leaves out stays out')
  const worded = rendererSummary(subject, kind => (kind === 'service' ? {singular: 'app', plural: 'apps'} : undefined))
  assert.deepEqual(nouns(worded, 'calls'), {singular: 'request', plural: 'requests'})
  assert.deepEqual(nouns(worded, 'service'), {singular: 'app', plural: 'apps'})
})

test('modules drawn only as boundaries round others are no summary figure; a kind with a card among them still is', async () => {
  const {boundaryNouns, comparisonModel, extractionModel} = await import('../dist/index.js')
  const {compare} = await import('./engine.mjs')
  const model = async (before, after) => comparisonModel(before, after, await compare(before, after))
  const grouped = extraction(
    [
      {id: 'core', label: 'core', kind: 'module'},
      {id: 'a', label: 'a', kind: 'service'},
      {id: 'b', label: 'b', kind: 'service'},
    ],
    [
      {id: 'core-a', kind: 'contains', from: 'core', to: 'a'},
      {id: 'core-b', kind: 'contains', from: 'core', to: 'b'},
      {id: 'ab', kind: 'calls', from: 'a', to: 'b'},
    ],
  )
  assert.deepEqual(boundaryNouns(extractionModel(grouped), true), {module: false})
  assert.deepEqual(boundaryNouns(await model(grouped, grouped), true), {module: false})
  // A module something depends on is drawn as a card, so modules are counted whole.
  const linked = {...grouped, entities: [...grouped.entities, {id: 'shared', label: 'shared', kind: 'module'}]}
  linked.relationships = [...grouped.relationships, {id: 'a-shared', kind: 'imports', from: 'a', to: 'shared'}]
  assert.deepEqual(boundaryNouns(await model(grouped, linked), true), {})
  // Only the kinds the canvas may draw as boundaries.
  assert.deepEqual(boundaryNouns(extractionModel(grouped), ['resource-group']), {})
})

test('a module each revision draws as a boundary but the diff union draws as a card is counted', async () => {
  const {boundaryNouns, comparisonModel} = await import('../dist/index.js')
  const {compare} = await import('./engine.mjs')
  // graph/storage-module: db and blobs move from the app module into a new storage module. Each revision draws every
  // module as a boundary, but in the union db and blobs have two parents, so app and storage are cards there.
  const scenarios = JSON.parse(await readFile(new URL('../../graph/scenarios.json', import.meta.url), 'utf8')).scenarios
  const {before, after} = scenarios.find(scenario => scenario.id === 'storage-module')
  const model = comparisonModel(before, after, await compare(before, after))
  assert.deepEqual(boundaryNouns({...model, mode: 'extraction', before, after: before}, true), {module: false}, 'one revision')
  assert.deepEqual(boundaryNouns(model, true), {})
})
