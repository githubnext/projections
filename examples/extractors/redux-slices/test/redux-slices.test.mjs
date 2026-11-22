import assert from 'node:assert/strict'
import {readFileSync, rmSync, writeFileSync} from 'node:fs'
import test from 'node:test'
import {canonical, cases, compare, expected, fixture, isolated, run} from '../../test-support.mjs'

test('reproduces the former built-in redux-slices extractor', async () => {
  for (const {name, inputs} of cases('redux-slices')) {
    assert.equal(
      await canonical(await run('redux-slices', fixture('redux-slices', name), inputs)),
      await canonical(expected('redux-slices', name)),
      name,
    )
  }
})

test('resolves renamed and barrel imports, actions, selectors and slice dependencies, ignoring look-alikes', async () => {
  const state = await run('redux-slices', fixture('redux-slices', 'slices'))
  assert.equal(state.schema, 'architecture/v0')
  assert.deepEqual(
    state.entities
      .filter(node => node.kind === 'slice')
      .map(node => node.label)
      .toSorted(),
    ['cart', 'checkout'],
  )
  assert.ok(state.entities.some(node => node.kind === 'selector' && node.label === 'total'))
  assert.ok(state.entities.some(node => node.kind === 'action' && node.label === 'add'))
  assert.equal(state.relationships.filter(edge => edge.kind === 'depends-on').length, 1)
})

test('a new action is a change; reformatting is not', async () => {
  const before = await run('redux-slices', fixture('redux-slices', 'slices'))
  await isolated('redux-slices', 'slices', async root => {
    const cart = `${root}/cart.ts`
    writeFileSync(cart, readFileSync(cart, 'utf8').replaceAll('; ', ';\n  '))
    assert.equal((await compare(before, await run('redux-slices', root))).changes.length, 0)
    writeFileSync(cart, readFileSync(cart, 'utf8').replace('reducers: {', 'reducers: { clear(state: number) { return 0; },'))
    const changes = (await compare(before, await run('redux-slices', root))).changes
    assert.ok(changes.some(change => change.status === 'added' && change.id.includes('action') && change.id.includes('clear')))
  })
})

test('no matching APIs is an empty architecture; invalid conventions fail', async () => {
  await isolated('redux-slices', 'slices', async root => {
    for (const file of ['barrel.ts', 'cart.ts', 'domains.d.ts']) rmSync(`${root}/${file}`)
    writeFileSync(`${root}/index.ts`, 'export const value = 1;\n')
    assert.equal((await run('redux-slices', root)).entities.length, 0)
  })
  await assert.rejects(run('redux-slices', fixture('redux-slices', 'slices'), {sliceApis: [{}]}), /requires nonempty module/u)
})
