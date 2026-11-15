import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  generatedPaths,
  generatedText,
  generatedWords,
  regenerated,
  variedBeyond,
  variedWithinTolerance,
  wordDiff,
} from '../dist/presentation.js'
import {defaultThemeTokens, iconNames, iconToken, isIconValue} from '../dist/protocol.js'

const extraction = {
  volatile: [
    {collection: 'entities', kinds: ['class'], path: '/data/summary', generated: true, basis: '/data/summaryBasis'},
    {collection: 'entities', path: '/data/methods/*/summary', generated: true, basis: '/data/methods/*/basis'},
    {collection: 'entities', path: '/data/durationMs'},
  ],
}

test('generated paths come from the declarations, with their concrete bases', () => {
  const item = {
    kind: 'class',
    data: {summary: 'Holds a cart.', summaryBasis: {input: 'sha256:a'}, methods: {add: {summary: 'Adds.', basis: {}}}},
  }
  assert.deepEqual(generatedPaths(extraction, item), [
    {path: '/data/methods/add/summary', basis: '/data/methods/add/basis'},
    {path: '/data/summary', basis: '/data/summaryBasis'},
  ])
  assert.deepEqual(generatedPaths(extraction, {...item, kind: 'service'}), [
    {path: '/data/methods/add/summary', basis: '/data/methods/add/basis'},
  ])
  assert.deepEqual(generatedPaths(extraction, item, 'relationships'), [])
  assert.deepEqual(generatedPaths({}, item), [])
})

test('regenerated changes are counted apart from other variation, and a basis change is no volatile marker', () => {
  const generated = {status: 'unchanged', varied: [{path: '/data/summary', within: true, generated: true}]}
  const timing = {status: 'unchanged', varied: [{path: '/data/durationMs', within: true}]}
  assert.equal(regenerated(generated), true)
  assert.equal(variedWithinTolerance(generated), false)
  assert.equal(regenerated(timing), false)
  assert.equal(variedWithinTolerance(timing), true)
  const moved = {status: 'modified', varied: [{path: '/data/summary', within: false, generated: true, because: ['input']}]}
  assert.equal(variedBeyond(moved), false)
})

test('why a generated value differs reads as a sentence, with verbatim parts', () => {
  assert.equal(generatedWords({within: true}), 'Regenerated from the same inputs')
  assert.equal(generatedWords({within: false, because: ['input']}), 'Regenerated because the input changed')
  assert.equal(generatedWords({within: false, because: ['context', 'prompt']}), 'Regenerated because `context` and the prompt changed')
  assert.equal(
    generatedWords(
      {within: false, because: ['input', 'model']},
      {before: {input: `sha256:${'a'.repeat(64)}`, model: 'm@1'}, after: {input: `sha256:${'b'.repeat(64)}`, model: 'm@2'}},
    ),
    'Regenerated because the input and the model (`m@1` → `m@2`) changed',
  )
  assert.equal(generatedWords({within: false, reason: 'Generated only after'}), 'Generated only after')
  assert.equal(generatedText({a: 1}), '{\n  "a": 1\n}')
})

test('a word diff keeps shared words and marks the rest', () => {
  assert.deepEqual(wordDiff('Holds a cart.', 'Holds a cart and its total.'), [
    {text: 'Holds a cart', op: 'same'},
    {text: ' and its total', op: 'added'},
    {text: '.', op: 'same'},
  ])
  assert.deepEqual(wordDiff('Validates orders.', 'Checks orders.'), [
    {text: 'Validates', op: 'removed'},
    {text: 'Checks', op: 'added'},
    {text: ' orders.', op: 'same'},
  ])
  assert.equal(wordDiff('x '.repeat(3000), 'y'), undefined)
})

test('the generated icon is in the vocabulary with a default image', () => {
  assert.ok(iconNames.includes('generated'))
  for (const mode of ['light', 'dark']) assert.ok(isIconValue(defaultThemeTokens(mode)[iconToken('generated')]))
})
