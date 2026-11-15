import assert from 'node:assert/strict'
import {appendFileSync} from 'node:fs'
import test from 'node:test'
import {canonical, cases, expected, fixture, isolated, run} from '../../test-support.mjs'

test('reproduces the former built-in http-routes extractor', async () => {
  for (const {name, inputs} of cases('http-routes')) {
    assert.equal(
      await canonical(await run('http-routes', fixture('http-routes', name), inputs)),
      await canonical(expected('http-routes', name)),
      name,
    )
  }
})

test('Express and Fastify factories, chains and method arrays become inferred routes with coverage warnings', async () => {
  const state = await run('http-routes', fixture('http-routes', 'routes'))
  assert.deepEqual(
    state.entities
      .filter(node => node.kind === 'route')
      .map(node => node.label)
      .sort(),
    ['GET /health', 'GET /items', 'GET /orders', 'GET /users', 'POST /orders', 'PUT /items'],
  )
  assert.match(JSON.stringify(state.metadata), /mounting/)
  assert(state.entities.filter(node => node.kind === 'route').every(node => node.confidence === 'inferred'))
})

test('CommonJS export-equals factories resolve as default imports', async () => {
  const state = await run('http-routes', fixture('http-routes', 'commonjs'))
  assert.deepEqual(
    state.entities
      .filter(node => node.kind === 'route')
      .map(node => node.label)
      .sort(),
    ['GET /real-commonjs', 'GET /router'],
  )
})

test('type errors fail with locations unless only syntax is checked', async () => {
  await isolated('http-routes', 'commonjs', async root => {
    appendFileSync(`${root}/index.ts`, 'export const broken: number = "text";\n')
    await assert.rejects(run('http-routes', root), /index\.ts:2: TS2322/)
    assert.equal((await run('http-routes', root, {diagnostics: 'syntax'})).entities.filter(node => node.kind === 'route').length, 2)
  })
})
