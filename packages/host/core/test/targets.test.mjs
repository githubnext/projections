import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createWasmEngine} from '@githubnext/projections-engine/browser'
import {
  decodeTarget,
  encodeTarget,
  isProjectionTarget,
  placeAnnotations,
  propertyPath,
  readPointer,
  resolveTarget,
  rowTargets,
  subjectRows,
  targetDigest,
  targetDigests,
} from '../dist/index.js'

const extraction = (entities, relationships = []) => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships})
const before = extraction(
  [
    {id: 'api', kind: 'service', label: 'API', data: {owner: 'web', ports: [80, 443]}},
    {id: 'queue', kind: 'queue', label: 'Queue'},
    {id: 'monolith', kind: 'service', label: 'Monolith'},
    {id: 'auth', kind: 'service', label: 'Auth'},
    {id: 'billing', kind: 'service', label: 'Billing'},
    {id: 'legacy', kind: 'service', label: 'Legacy'},
  ],
  [{id: 'calls', kind: 'calls', from: 'api', to: 'queue'}],
)
const after = extraction(
  [
    {id: 'api', kind: 'service', label: 'API', data: {owner: 'platform', ports: [443]}},
    {id: 'worker', kind: 'service', label: 'Worker', previousIds: ['queue']},
    {id: 'orders', kind: 'service', label: 'Orders'},
    {id: 'payments', kind: 'service', label: 'Payments'},
    {id: 'accounts', kind: 'service', label: 'Accounts'},
    {id: 'fresh', kind: 'service', label: 'Fresh'},
  ],
  [{id: 'calls', kind: 'calls', from: 'api', to: 'worker'}],
)
const comparison = {
  protocolVersion: 0,
  changes: [
    {id: 'api', collection: 'entities', before: ['api'], after: ['api'], status: 'modified', correspondence: 'exact'},
    {id: 'worker', collection: 'entities', before: ['queue'], after: ['worker'], status: 'unchanged', correspondence: 'declared'},
    {
      id: 'split',
      collection: 'entities',
      before: ['monolith'],
      after: ['orders', 'payments'],
      status: 'unchanged',
      correspondence: 'split',
    },
    {id: 'merge', collection: 'entities', before: ['auth', 'billing'], after: ['accounts'], status: 'unchanged', correspondence: 'merge'},
    {id: 'legacy', collection: 'entities', before: ['legacy'], after: [], status: 'removed', correspondence: 'exact'},
    {id: 'fresh', collection: 'entities', before: [], after: ['fresh'], status: 'added', correspondence: 'exact'},
    {id: 'calls', collection: 'relationships', before: ['calls'], after: ['calls'], status: 'modified', correspondence: 'exact'},
  ],
  steps: [{changes: ['api', 'worker', 'split', 'merge', 'legacy', 'fresh', 'calls']}],
}
const compared = {mode: 'comparison', before, after, comparison}
const single = {mode: 'extraction', extraction: after}
const rows = subjectRows(compared)
const row = id => rows.find(item => item.id === id)

test('a row stands for its items on each side, including split, merged, removed and added items', () => {
  assert.deepEqual(rowTargets(row('api'), compared), [
    {kind: 'entity', id: 'api', side: 'before'},
    {kind: 'entity', id: 'api', side: 'after'},
  ])
  assert.deepEqual(rowTargets(row('worker'), compared), [
    {kind: 'entity', id: 'queue', side: 'before'},
    {kind: 'entity', id: 'worker', side: 'after'},
  ])
  assert.deepEqual(
    rowTargets(row('split'), compared).map(target => `${target.side}:${target.id}`),
    ['before:monolith', 'after:orders', 'after:payments'],
  )
  assert.deepEqual(
    rowTargets(row('merge'), compared).map(target => `${target.side}:${target.id}`),
    ['before:auth', 'before:billing', 'after:accounts'],
  )
  assert.deepEqual(rowTargets(row('legacy'), compared), [{kind: 'entity', id: 'legacy', side: 'before'}])
  assert.deepEqual(rowTargets(row('fresh'), compared), [{kind: 'entity', id: 'fresh', side: 'after'}])
  assert.deepEqual(
    rowTargets(row('calls'), compared).map(target => target.kind),
    ['relationship', 'relationship'],
  )
  const singleRows = subjectRows(single)
  assert.deepEqual(
    rowTargets(
      singleRows.find(item => item.id === 'api'),
      single,
    ),
    [{kind: 'entity', id: 'api', side: 'after'}],
  )
})

test('targets resolve to the row presenting them, by extraction identity on their side', () => {
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'entity', id: 'queue', side: 'before'}), {status: 'present', rowId: 'worker'})
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'entity', id: 'worker', side: 'after'}), {status: 'present', rowId: 'worker'})
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'entity', id: 'payments', side: 'after'}), {status: 'present', rowId: 'split'})
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'entity', id: 'billing', side: 'before'}), {status: 'present', rowId: 'merge'})
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'relationship', id: 'calls', side: 'after'}), {status: 'present', rowId: 'calls'})
  // A removed item exists only before; an added one only after.
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'entity', id: 'legacy', side: 'after'}), {status: 'absent', reason: 'item'})
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'entity', id: 'fresh', side: 'before'}), {status: 'absent', reason: 'item'})
  // Kinds don't mix, and unknown IDs are absent.
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'relationship', id: 'api', side: 'after'}), {status: 'absent', reason: 'item'})
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'entity', id: 'nowhere', side: 'after'}), {status: 'absent', reason: 'item'})
  // Properties resolve into the item's data.
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'entity', id: 'api', side: 'before', path: '/ports/1'}), {
    status: 'present',
    rowId: 'api',
  })
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'entity', id: 'api', side: 'after', path: '/ports/1'}), {
    status: 'absent',
    reason: 'property',
    rowId: 'api',
  })
  // A single extraction has only an after side.
  const singleRows = subjectRows(single)
  assert.deepEqual(resolveTarget(single, singleRows, {kind: 'entity', id: 'api', side: 'after'}), {status: 'present', rowId: 'api'})
  assert.deepEqual(resolveTarget(single, singleRows, {kind: 'entity', id: 'api', side: 'before'}), {status: 'absent', reason: 'side'})
  assert.deepEqual(resolveTarget(compared, rows, {kind: 'entity', id: 'api', side: 'left'}), {status: 'absent', reason: 'item'})
})

test('annotations combine per presented row; unpresented targets are listed', () => {
  const placed = placeAnnotations(compared, rows, [
    {target: {kind: 'entity', id: 'orders', side: 'after'}, count: 2, tone: 'done'},
    {target: {kind: 'entity', id: 'monolith', side: 'before'}, count: 1, tone: 'attention'},
    {target: {kind: 'entity', id: 'api', side: 'after', path: '/owner'}, count: 3, label: '3 comments'},
    {target: {kind: 'entity', id: 'gone', side: 'after'}, count: 1},
  ])
  assert.deepEqual(placed.marks, [
    {id: 'split', count: 3, tone: 'attention'},
    {id: 'api', count: 3, label: '3 comments'},
  ])
  assert.deepEqual(
    placed.unplaced.map(item => item.target.id),
    ['gone'],
  )
  assert.equal(placed.byRow.get('split').length, 2)
})

test('targets encode to URL-safe text and back', () => {
  for (const target of [
    {kind: 'entity', id: 'api', side: 'after'},
    {kind: 'relationship', id: 'a.b/c d', side: 'before'},
    {kind: 'entity', id: 'ünïcødé.%', side: 'after', path: '/ports/0'},
    {kind: 'entity', id: 'x', side: 'after', path: propertyPath('a/b', 'c~d', 0)},
  ]) {
    const text = encodeTarget(target)
    assert.match(text, /^[\w.~%-]+$/u)
    assert.deepEqual(decodeTarget(text), target)
  }
  assert.equal(propertyPath('a/b', 'c~d', 0), '/a~1b/c~0d/0')
  for (const text of [
    '',
    'entity.after',
    'node.after.x',
    'entity.left.x',
    'entity.after.x.nopath',
    'entity.after.%E0%A4',
    'entity.after.x.%2Fa.extra',
  ]) {
    assert.equal(decodeTarget(text), undefined, text)
  }
  assert.equal(isProjectionTarget({kind: 'entity', id: 'x', side: 'after', extra: 1}), false)
  assert.equal(readPointer({a: [{b: 1}]}, '/a/0/b'), 1)
  assert.equal(readPointer({a: [1]}, '/a/01'), undefined)
  assert.equal(readPointer({'a/b': 2}, '/a~1b'), 2)
})

test('target digests use the engine canonical form and change only with the target', async () => {
  const require = createRequire(import.meta.url)
  const engineDirectory = new URL('.', `file://${require.resolve('@githubnext/projections-engine/engine.wasm')}`)
  const engine = await createWasmEngine(
    {module: await readFile(new URL('engine.wasm', engineDirectory))},
    {module: await readFile(new URL('default-comparator.wasm', engineDirectory))},
  )
  const api = {kind: 'entity', id: 'api', side: 'after'}
  const owner = {...api, path: '/owner'}
  const [beforeApi, beforeOwner, beforeAuth] = await targetDigests(engine, before, [
    api,
    owner,
    {kind: 'entity', id: 'auth', side: 'after'},
  ])
  const [afterApi, afterOwner, missing] = await targetDigests(engine, after, [api, owner, {kind: 'entity', id: 'auth', side: 'after'}])
  assert.match(beforeApi, /^sha256:[0-9a-f]{64}$/u)
  assert.notEqual(beforeApi, afterApi)
  assert.notEqual(beforeOwner, afterOwner)
  assert.ok(beforeAuth)
  assert.equal(missing, undefined)
  // Key order and other items don't matter.
  const reordered = extraction([{label: 'API', data: {ports: [443], owner: 'platform'}, kind: 'service', id: 'api'}])
  assert.equal(await targetDigest(engine, reordered, api), afterApi)
  assert.equal(await targetDigest(engine, reordered, {...api, path: '/ports/1'}), undefined)
})
