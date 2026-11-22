import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {domainSchemas, protocolVersion} from '../dist/index.js'

test('the public contract has seven domain schemas and no extractor catalog dependency', () => {
  assert.equal(protocolVersion, 0)
  assert.equal(domainSchemas.length, 7)
  assert.equal(new Set(domainSchemas).size, 7)
  assert.ok(domainSchemas.every(schema => schema.endsWith('/v0')))
  assert.ok(domainSchemas.includes('database/v0'))
  assert.ok(!domainSchemas.includes('schema/v0'))
  const declarations = readFileSync(new URL('../dist/index.d.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(declarations, /playground|primer|BuiltinCollectorId/u)
  // Types come from the package's own TypeBox schemas, as types only: the entry loads no schema builder.
  for (const [, source] of declarations.matchAll(/from\s+['"]([^'"]+)['"]/gu)) assert.match(source, /^(?:typebox|\.\/.+)$/u)
  const entry = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8')
  assert.doesNotMatch(entry, /['"](?:typebox|\.\/typebox\/[^'"]*)['"]/u)
  assert.doesNotMatch(declarations, /\b(?:nodes|edges|stateDigest|ProjectionState|SnapshotDocument|collector)\b/u)
})

test('the shared native/Wasm conformance corpus covers raw input, comparison integrity and the default comparator', () => {
  const corpus = JSON.parse(readFileSync(new URL('../fixtures/conformance.json', import.meta.url), 'utf8'))
  assert.equal(corpus.version, 0)
  const ids = [...corpus.cases, ...corpus.comparisons].map(item => item.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(corpus.cases.some(item => item.expectedCanonical))
  assert.ok(corpus.cases.some(item => item.id === 'duplicate-json-key' && item.expectError === 'duplicate-key'))
  assert.ok(corpus.cases.some(item => item.id === 'unsafe-integer' && item.expectError === 'unsafe-integer'))
  assert.ok(corpus.cases.some(item => item.request.operation === 'validate-comparison' && item.expectError === 'hidden-change'))
  assert.ok(corpus.comparisons.some(item => item.expected?.changes.some(change => change.correspondence === 'declared')))
  assert.ok(corpus.comparisons.some(item => item.expected?.changes.some(change => change.correspondence === 'split')))
  assert.ok(corpus.comparisons.some(item => item.expectError === 'ambiguous-correspondence'))
  assert.ok(corpus.cases.some(item => item.request.operation === 'vary' && item.expectedResult))
  assert.ok(corpus.comparisons.some(item => item.expected?.variation))
  for (const item of corpus.cases) assert.equal(item.request.version, 0)
  for (const item of corpus.comparisons) {
    for (const side of [item.before, item.after]) assert.equal(side.protocolVersion, 0)
  }
})
