import {test} from 'node:test'
import assert from 'node:assert/strict'
import {identifierParts} from '../dist/index.js'

const code = text =>
  identifierParts(text)
    .filter(part => part.code)
    .map(part => part.text)

test('identifiers inside prose are code, with their punctuation left to the prose', () => {
  assert.deepEqual(code('Calls fetchJson() from ("app.js"), then GET /api/cart; reads user_id and checkout.latency.p50.'), [
    'fetchJson()',
    'app.js',
    'GET /api/cart',
    'user_id',
    'checkout.latency.p50',
  ])
  assert.deepEqual(code('Install dependencies and/or _private or trailing_'), [])
})

test('a long run of punctuation or underscores is read in linear time', () => {
  const started = performance.now()
  for (const text of [`a${'!'.repeat(100_000)}a`, `$${'_'.repeat(100_000)}!`, `(${'['.repeat(100_000)}`]) identifierParts(text)
  assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)} ms`)
  assert.deepEqual(code(`$_${'_'.repeat(100_000)}a`), [`$_${'_'.repeat(100_000)}a`])
})
