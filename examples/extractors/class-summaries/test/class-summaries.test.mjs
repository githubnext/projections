import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {basisDigest} from '@githubnext/projections/extractor'
import {checkout, compare, fixture, isolated} from '../../test-support.mjs'
import {createNativeEngine} from '@githubnext/projections-engine/native'

const engine = createNativeEngine()
const extractor = path.join(import.meta.dirname, '..', 'extract.mjs')

/** Runs the sample as the CLI would, with a fake model sample, optional inputs and an optional store snapshot. */
async function summarize(root, {sample = '', inputs = {}, snapshot} = {}) {
  const request = {
    protocolVersion: 0,
    projection: {id: 'class-summaries', definition: {id: 'class-summaries', extractor: {command: ['node', 'extract.mjs']}, inputs}},
    repository: {root, checkout, revision: {kind: 'working-tree', ref: 'WORKTREE', commit: 'fixture', dirty: false}},
    capabilities: {trusted: true, network: false},
    ...(snapshot ? {generations: {file: snapshot}} : {}),
  }
  const result = spawnSync(process.execPath, [extractor], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    env: {PATH: process.env.PATH, FAKE_SUMMARIZER_SAMPLE: sample},
  })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `exit ${result.status}`)
  return engine.normalize(JSON.parse(result.stdout))
}

const classes = extraction => extraction.entities.filter(entity => entity.kind === 'class')
const varied = (comparison, label) => comparison.changes.find(change => change.id.endsWith(`:${label}`))

/** The generation store's snapshot of an extraction's summaries, as the runner writes it. */
function snapshotOf(extraction) {
  const directory = mkdtempSync(path.join(tmpdir(), 'projections-generations-'))
  const file = path.join(directory, 'generations.jsonl')
  writeFileSync(
    file,
    classes(extraction)
      .map(entity => JSON.stringify({path: '/data/summary', basis: basisDigest(entity.data.summaryBasis), value: entity.data.summary}))
      .join('\n'),
  )
  return {file, remove: () => rmSync(directory, {recursive: true, force: true})}
}

test('classes carry generated summaries with a basis of input, prompt and model', async () => {
  const extraction = await summarize(fixture('class-summaries', 'shop'))
  assert.deepEqual(
    classes(extraction).map(entity => entity.label),
    ['Cart', 'Orders'],
  )
  const cart = classes(extraction).find(entity => entity.label === 'Cart')
  assert.match(cart.data.summary, /^Cart .*items, add, remove\.$/)
  assert.deepEqual(Object.keys(cart.data.summaryBasis).toSorted(), ['input', 'model', 'prompt'])
  assert.equal(cart.data.summaryBasis.model, 'fake-summarizer@1')
  assert.match(cart.data.summaryBasis.input, /^sha256:[0-9a-f]{64}$/)
  assert.deepEqual(extraction.volatile, [
    {collection: 'entities', kinds: ['class'], path: '/data/summary', generated: true, basis: '/data/summaryBasis'},
  ])
})

test('rewording from the same inputs is expected variation, and the store makes reruns identical', async () => {
  const root = fixture('class-summaries', 'shop')
  const first = await summarize(root, {sample: 'a'})
  // Find a sample that rewords at least one summary.
  let second
  for (const sample of ['b', 'c', 'd', 'e', 'f']) {
    second = await summarize(root, {sample})
    if (JSON.stringify(second) !== JSON.stringify(first)) break
  }
  assert.notDeepEqual(second, first)
  const comparison = await compare(first, second)
  for (const change of comparison.changes) {
    assert.equal(change.status, 'unchanged')
    assert.deepEqual(change.varied, [{path: '/data/summary', within: true, generated: true}])
  }
  assert.deepEqual(comparison.steps, [])

  const snapshot = snapshotOf(first)
  try {
    const reused = await summarize(root, {sample: 'z', snapshot: snapshot.file})
    assert.deepEqual(reused, first)
  } finally {
    snapshot.remove()
  }
})

test('a changed class and a changed model are changes, saying which part of the basis moved', async () => {
  await isolated('class-summaries', 'shop', async root => {
    const before = await summarize(root)
    const cart = path.join(root, 'src/cart.ts')
    writeFileSync(cart, readFileSync(cart, 'utf8').replace('  remove(', '  clear() {\n    this.items = []\n  }\n\n  remove('))
    const after = await summarize(root)
    const comparison = await compare(before, after)
    assert.deepEqual(varied(comparison, 'Cart').varied, [{path: '/data/summary', within: false, generated: true, because: ['input']}])
    assert.equal(varied(comparison, 'Cart').status, 'modified')
    assert.equal(varied(comparison, 'Orders'), undefined)

    const upgraded = await summarize(root, {inputs: {model: 'fake-summarizer@2'}})
    const models = await compare(after, upgraded)
    for (const label of ['Cart', 'Orders']) {
      assert.equal(varied(models, label).status, 'modified')
      assert.deepEqual(varied(models, label).varied[0].because, ['model'])
    }
  })
})
