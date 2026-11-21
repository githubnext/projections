import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Linter} from 'eslint'
import {engineContractsRule} from './engine-contracts.mjs'

const linter = new Linter({configType: 'flat'})
const flagged = code =>
  linter.verify(code, {
    languageOptions: {ecmaVersion: 'latest', sourceType: 'module'},
    rules: {'no-restricted-syntax': engineContractsRule},
  }).length

test('code outside the engine that re-derives its pairing or review is flagged', () => {
  for (const code of [
    'before.provenance.definitionDigest !== after.provenance.definitionDigest',
    'a.provenance.definitionDigest == b.provenance.definitionDigest',
    'isDeepStrictEqual(before.provenance.definition, after.provenance.definition)',
    'util.isDeepStrictEqual(before.provenance.definition, other)',
    'sameJson(withoutPresentation(value.before.provenance.definition), right)',
    'const {presentation, ...rest} = definition',
    'document.comparison.changes.length > 0',
    'if (!comparison.changes.length) skip()',
    'comparison.changes.some(change => change.status !== "unchanged")',
  ])
    assert.ok(flagged(code) > 0, code)
})

test('reading those fields, or comparing a digest with something else, is not', () => {
  for (const code of [
    'const digest = document.provenance.definitionDigest',
    // Staleness: a result's digest against the working tree's, not two extractions against each other.
    'side.definitionDigest !== identity.definitionDigest',
    'await engine.pair(before, after)',
    'show(before.provenance.definition)',
    'const {presentation, ...props} = options',
    // Counting what's listed, for display, isn't deciding whether anything changed.
    'label(comparison.changes.length)',
    'await engine.review(comparison)',
  ])
    assert.equal(flagged(code), 0, code)
})
