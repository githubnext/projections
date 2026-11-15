import assert from 'node:assert/strict'
import test from 'node:test'
import {
  definitionModel,
  extractionMessages,
  flattenSources,
  follow,
  keptSides,
  sourceItems,
  unusualProvenance,
} from '../src/configuration-model.ts'

test('the view follows the active projection tab, keeps it while one of its files is open, and a pin wins', () => {
  const a = {folder: 'f', projection: 'packages'}
  const b = {folder: 'f', projection: 'routes'}
  assert.equal(follow({pinned: undefined, tab: a, shown: b}), a)
  assert.equal(follow({pinned: b, tab: a, shown: a}), b)
  // Opening the shown projection's definition (from the view) keeps it; another file empties it, as Outline does.
  assert.equal(follow({pinned: undefined, tab: undefined, shown: a, editor: 'file:///d.json', files: ['file:///d.json']}), a)
  assert.equal(follow({pinned: undefined, tab: undefined, shown: a, editor: 'file:///other.ts', files: ['file:///d.json']}), undefined)
  assert.equal(follow({pinned: undefined, tab: undefined, shown: undefined}), undefined)
})

test("a tab's kept results become sides, and their diagnostics messages named by side", () => {
  const kept = {
    pair: {before: 'main', after: 'working-tree'},
    results: {
      main: {document: {diagnostics: [{message: 'one'}]}},
      'working-tree': {document: {extraction: {diagnostics: [{message: 'one'}, {message: 'two'}]}}},
    },
  }
  const sides = keptSides(kept)
  assert.deepEqual(
    sides.map(item => [item.side, item.ref]),
    [
      ['Before', 'main'],
      ['After', 'working-tree'],
    ],
  )
  assert.deepEqual(extractionMessages(sides), ['Before: one', 'After: two'])
  assert.deepEqual(
    keptSides({pair: {after: 'working-tree'}, results: {'working-tree': {document: {}}}}).map(item => item.side),
    ['Shown'],
  )
  assert.deepEqual(keptSides(undefined), [])
})

test('the tab shows a provenance badge only when the result is unusual', () => {
  assert.equal(unusualProvenance('Local'), false)
  assert.equal(unusualProvenance(undefined), false)
  for (const label of ['From CI', 'Approximate', 'Stale', 'Observed']) assert.equal(unusualProvenance(label), true)
})

test('Go to Source… lists the files behind a projection, grouped, in order', () => {
  const docs = name => `${name}s/built-in.md`
  // Built-ins only: the definition is the one file; the parts are their bundled docs and Configure….
  const builtIns = sourceItems({
    definition: '.github/projections/packages.json',
    parts: [
      {part: 'extractor', label: 'workspace-dependencies', docs: docs('extractor')},
      {part: 'comparator', label: 'default', docs: docs('comparator')},
      {part: 'renderer', label: 'dependencies', docs: docs('renderer')},
    ],
  })
  assert.deepEqual(
    builtIns.map(item => [item.group, item.label, item.file ?? item.command ?? item.docs]),
    [
      ['Definition', 'packages.json', '.github/projections/packages.json'],
      ['Extractor', 'workspace-dependencies (built-in)', docs('extractor')],
      ['Comparator', 'Default · Configure…', 'projections.configureComparator'],
      ['Renderer', 'dependencies (built-in)', docs('renderer')],
    ],
  )
  assert.equal(builtIns.filter(item => item.file).length, 1)
  // Configure… the default comparator keeps its docs, for the item's Open Documentation button.
  assert.equal(builtIns[2].docs, docs('comparator'))
  // A custom renderer (its source entry and scenarios), a comparator file with tests, a script extractor, an environment.
  const custom = sourceItems({
    definition: '.github/projections/cards.json',
    parts: [
      {part: 'extractor', label: 'node tools/extract.mjs', file: 'tools/extract.mjs'},
      {part: 'comparator', label: 'tools/cards.comparator.yaml', file: 'tools/cards.comparator.yaml'},
      {part: 'renderer', label: 'renderers/cards/dist'},
    ],
    comparatorTests: 'tools/cards.comparator.test.yaml',
    rendererSource: 'renderers/cards/src/index.tsx',
    scenarios: ['renderers/cards/scenarios.json'],
    environment: '.github/projections/environment.json',
  })
  assert.deepEqual(
    custom.map(item => [item.group, item.file]),
    [
      ['Definition', '.github/projections/cards.json'],
      ['Extractor', 'tools/extract.mjs'],
      ['Comparator', 'tools/cards.comparator.yaml'],
      ['Comparator', 'tools/cards.comparator.test.yaml'],
      ['Renderer', 'renderers/cards/src/index.tsx'],
      ['Renderer', 'renderers/cards/scenarios.json'],
      ['Environment', '.github/projections/environment.json'],
    ],
  )
  // A comparator file without tests lists only itself.
  const untested = sourceItems({parts: [{part: 'comparator', label: 'c.comparator.yaml', file: 'c.comparator.yaml'}]})
  assert.deepEqual(
    untested.map(item => item.file),
    ['c.comparator.yaml'],
  )
})

test('the Definition view and Go to Source… share one model: the file, then each part with its own files under it', () => {
  const nodes = definitionModel({
    definition: '.github/projections/cards.json',
    parts: [
      {
        part: 'extractor',
        label: 'workspace-dependencies',
        docs: 'extractors/workspace-dependencies.md',
      },
      {part: 'comparator', label: 'tools/cards.comparator.yaml', file: 'tools/cards.comparator.yaml'},
      {part: 'renderer', label: '.github/projections/cards/dist'},
    ],
    comparatorTests: 'tools/cards.comparator.test.yaml',
    rendererSource: '.github/projections/cards/src/index.tsx',
    scenarios: [
      {
        path: '.github/projections/cards/scenarios.json',
        directory: '.github/projections/cards',
        count: 3,
      },
    ],
    environment: '.github/projections/environment.json',
  })
  const shape = list => list.map(node => [node.kind, node.label, node.value ?? null, shape(node.children)])
  // The definition file is named by its file; parts by their kind with their value verbatim; no Provenance.
  assert.deepEqual(shape(nodes), [
    ['definition', 'cards.json', null, []],
    ['extractor', 'Extractor', 'workspace-dependencies', []],
    ['comparator', 'Comparator', 'tools/cards.comparator.yaml', [['tests', 'cards.comparator.test.yaml', null, []]]],
    [
      'renderer',
      'Renderer',
      '.github/projections/cards/dist',
      [
        ['source', 'index.tsx', null, []],
        ['scenarios', 'Scenarios', '.github/projections/cards', []],
      ],
    ],
    ['environment', 'Environment', 'environment.json', []],
  ])
  assert.equal(nodes[3].children[1].count, 3)
  // Go to Source… is the same model flattened.
  assert.deepEqual(
    flattenSources(nodes).map(item => [item.group, item.file ?? item.docs]),
    [
      ['Definition', '.github/projections/cards.json'],
      ['Extractor', 'extractors/workspace-dependencies.md'],
      ['Comparator', 'tools/cards.comparator.yaml'],
      ['Comparator', 'tools/cards.comparator.test.yaml'],
      ['Renderer', '.github/projections/cards/src/index.tsx'],
      ['Renderer', '.github/projections/cards/scenarios.json'],
      ['Environment', '.github/projections/environment.json'],
    ],
  )
  // The default comparator is Configure…; its tests aren't listed without a comparator file.
  const defaultComparator = definitionModel({parts: [{part: 'comparator', label: 'default'}], comparatorTests: 'x.comparator.test.yaml'})
  assert.deepEqual([defaultComparator[0].command, defaultComparator[0].children.length], ['projections.configureComparator', 0])
})
