// Unit tests of edit detection (`edits.ts`): the files a definition declares, git status, and which definition a
// tab applies; loaded from source with Node's type stripping.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {declaredFiles, definitionRevisionFor, editKey, editState, parseStatus, presentationFiles, touchedEntries} from '../src/edits.ts'
import {relevantFiles, staleness} from '../src/staleness.ts'
import {staleByChanges} from '../src/staleness/changes.ts'

test('the files a definition declares', () => {
  assert.deepEqual(declaredFiles({id: 'packages', extractor: 'workspace-dependencies', renderer: 'graph'}), [])
  assert.deepEqual(
    declaredFiles({
      id: 'api',
      extractor: {command: ['node', './tools/extract.mjs', '--json'], sources: ['tools/lib/']},
      comparator: {file: 'tools/api.comparator.yaml'},
      renderer: {bundle: 'packages/renderers/api/dist', sources: ['packages/renderers/api/src']},
    }),
    ['tools/extract.mjs', 'tools/lib', 'tools/api.comparator.yaml', 'packages/renderers/api/dist', 'packages/renderers/api/src'],
  )
  assert.deepEqual(declaredFiles({id: 'x', extractor: 'a', comparator: 'x.comparator.yaml', renderer: 'graph'}), ['x.comparator.yaml'])
  // Never outside the repository.
  assert.deepEqual(declaredFiles({id: 'x', extractor: {command: ['node', '../escape.js']}, renderer: 'graph'}), [])
})

test("a nested project's files, repository-relative: its paths are relative to it", () => {
  const definition = {
    id: 'api',
    extractor: {command: ['node', '.github/projections/api/extract.mjs'], sources: ['../shared/lib']},
    comparator: 'api.comparator.yaml',
    renderer: {bundle: 'renderer/dist', sources: ['renderer/src']},
  }
  assert.deepEqual(declaredFiles(definition, 'packages/app/'), [
    'packages/app/.github/projections/api/extract.mjs',
    'packages/shared/lib',
    'packages/app/api.comparator.yaml',
    'packages/app/renderer/dist',
    'packages/app/renderer/src',
  ])
  assert.deepEqual(presentationFiles(definition, 'packages/app/'), [
    'packages/app/api.comparator.yaml',
    'packages/app/renderer/dist',
    'packages/app/renderer',
    'packages/app/renderer/src',
  ])
  // Out of the project, never out of the repository.
  assert.deepEqual(declaredFiles({id: 'x', extractor: {command: ['node', '../../../x.js']}, renderer: 'graph'}, 'packages/app/'), [])
})

test('git status and the edit state', () => {
  const status = parseStatus(' M .github/projections/api.json\0?? tools/lib/new.mjs\0R  b.yaml\0a.yaml\0')
  assert.deepEqual(status, [
    {code: ' M', path: '.github/projections/api.json'},
    {code: '??', path: 'tools/lib/new.mjs'},
    {code: 'R ', path: 'b.yaml'},
  ])
  assert.equal(editState('.github/projections/api.json', [], status, true), 'edited')
  // A file under a declared directory.
  assert.equal(editState('.github/projections/other.json', ['tools/lib'], status, true), 'edited')
  assert.equal(editState('.github/projections/other.json', ['tools/extract.mjs'], status, true), undefined)
  // Not in HEAD: new, used as it is.
  assert.equal(editState('.github/projections/legacy.json', [], status, false), 'new')
})

test('which definition a tab applies: the edits, unless Show committed', () => {
  const base = {now: false, state: 'edited', committed: false, hasCommits: true}
  assert.equal(definitionRevisionFor(base), 'working-tree')
  assert.equal(definitionRevisionFor({...base, now: true}), 'working-tree')
  // Show committed holds the tab on the committed definition, Current state included.
  assert.equal(definitionRevisionFor({...base, committed: true}), 'HEAD')
  assert.equal(definitionRevisionFor({...base, committed: true, now: true}), 'HEAD')
  // No edits: the committed definition, except on Current state (where they are the same).
  assert.equal(definitionRevisionFor({...base, state: undefined}), 'HEAD')
  assert.equal(definitionRevisionFor({...base, state: undefined, committed: true}), 'HEAD')
  assert.equal(definitionRevisionFor({...base, state: undefined, now: true}), 'working-tree')
  // Never committed: there is no committed version.
  assert.equal(definitionRevisionFor({...base, state: 'new', committed: true}), 'working-tree')
  assert.equal(definitionRevisionFor({...base, hasCommits: false, committed: true}), 'working-tree')
})

test("the edits' key changes with every save, and only with this projection's files", () => {
  const status = parseStatus(' M .github/projections/api.json\0?? tools/lib/new.mjs\0 D tools/old.mjs\0 M other/file.txt\0')
  const touched = touchedEntries('.github/projections/api.json', ['tools/lib', 'tools/old.mjs'], status)
  assert.deepEqual(
    touched.map(entry => entry.path),
    ['.github/projections/api.json', 'tools/lib/new.mjs', 'tools/old.mjs'],
  )
  const hashes = new Map([
    ['.github/projections/api.json', '1'.repeat(40)],
    ['tools/lib/new.mjs', '2'.repeat(40)],
    ['other/file.txt', '3'.repeat(40)],
  ])
  const key = editKey(touched, hashes)
  assert.equal(editKey(touched, new Map([...hashes, ['other/file.txt', '4'.repeat(40)]])), key)
  assert.notEqual(editKey(touched, new Map([...hashes, ['tools/lib/new.mjs', '5'.repeat(40)]])), key)
  assert.notEqual(editKey(touched.slice(1), hashes), key)
  assert.equal(editKey([], hashes), undefined)
})

test('a result with the committed definition: out of date when the definition is edited, unless the tab shows the committed version', () => {
  const head = 'a'.repeat(40)
  const stamp = {
    projection: 'packages',
    pair: {before: 'c'.repeat(40), after: 'working-tree'},
    generation: 4,
    head,
    definition: 'HEAD',
    sides: [{ref: 'c'.repeat(40)}, {ref: 'working-tree'}],
  }
  const records = changes => [{generation: 5, changes, complete: true}]
  // The tab applies the edits now: Refresh applies them.
  assert.deepEqual(staleByChanges(stamp, {records: records(['definitions']), head, definition: 'working-tree'}), {
    tier: 'extraction',
    why: 'definition',
  })
  // Show committed: editing the definition changes nothing the result read.
  assert.equal(staleByChanges(stamp, {records: records(['definitions']), head, definition: 'HEAD'}), undefined)
  assert.equal(staleByChanges(stamp, {records: records(['definitions']), head}), undefined)
  assert.deepEqual(staleByChanges({...stamp, definition: 'working-tree'}, {records: records(['definitions']), head}), {
    tier: 'extraction',
    why: 'definition',
  })
  // A commit moves HEAD, and with it the committed definition.
  const commits = {...stamp, pair: {before: 'c'.repeat(40), after: 'b'.repeat(40)}, sides: [{ref: 'c'.repeat(40)}, {ref: 'b'.repeat(40)}]}
  assert.equal(staleByChanges(commits, {records: records(['working-tree']), head}), undefined)
  assert.deepEqual(staleByChanges(commits, {records: records(['working-tree']), head: 'd'.repeat(40)}), {
    tier: 'extraction',
    why: 'refs moved',
  })
  // The identity's definition digest is the working tree's: it judges a committed-definition result only when the tab
  // applies the edits now.
  const withDigest = {...stamp, sides: [{ref: 'working-tree', definitionDigest: 'sha256:1', execution: {tree: 'e'.repeat(40)}}]}
  const identity = {tree: 'e'.repeat(40), definitionDigest: 'sha256:2'}
  assert.equal(staleness(withDigest, {records: [], head, identity, definition: 'HEAD'}), undefined)
  assert.deepEqual(staleness(withDigest, {records: [], head, identity, definition: 'working-tree'}), {
    tier: 'extraction',
    why: 'definition',
  })
  // Definition files changed: they bear on the result once the tab applies the edits.
  const files = ['.github/projections/packages.json']
  assert.deepEqual(relevantFiles(stamp, files, 'HEAD'), [])
  assert.deepEqual(relevantFiles(stamp, files, 'working-tree'), files)
  assert.deepEqual(
    staleness(
      {...withDigest, definition: 'working-tree'},
      {records: [], head, identity: {tree: 'e'.repeat(40), definitionDigest: 'sha256:2'}},
    ),
    {tier: 'extraction', why: 'definition'},
  )
})

test("a renderer or comparator edit isn't a change to what the result read, though it changes the digest", () => {
  const definition = {
    id: 'cards',
    extractor: {command: ['node', 'tools/extract.mjs']},
    comparator: 'tools/cards.comparator.yaml',
    renderer: {bundle: '.github/projections/cards/renderer/dist', sources: ['.github/projections/cards/renderer/src']},
  }
  assert.deepEqual(presentationFiles(definition), [
    'tools/cards.comparator.yaml',
    '.github/projections/cards/renderer/dist',
    '.github/projections/cards/renderer',
    '.github/projections/cards/renderer/src',
  ])
  const stamp = {
    projection: 'cards',
    pair: {after: 'working-tree'},
    generation: 1,
    definition: 'working-tree',
    sides: [{ref: 'working-tree'}],
  }
  const presentation = presentationFiles(definition)
  const files = [
    '.github/projections/cards/renderer/src/view.tsx',
    '.github/projections/cards/renderer/package.json',
    'tools/cards.comparator.yaml',
  ]
  assert.deepEqual(relevantFiles(stamp, files, 'working-tree', presentation), [])
  // The definition and the extractor's script still bear on it.
  assert.deepEqual(relevantFiles(stamp, [...files, '.github/projections/cards.json', 'tools/extract.mjs'], 'working-tree', presentation), [
    '.github/projections/cards.json',
    'tools/extract.mjs',
  ])
})
