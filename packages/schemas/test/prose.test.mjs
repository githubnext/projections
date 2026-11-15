import assert from 'node:assert/strict'
import {test} from 'node:test'
import {codeSpan, escapeProse, plainProse, proseSpans} from '../dist/index.js'

test('backticks mark inline code; backslashes escape them', () => {
  assert.deepEqual(proseSpans('Parameter `currency` was renamed to `currencyCode`'), [
    {text: 'Parameter ', code: false},
    {text: 'currency', code: true},
    {text: ' was renamed to ', code: false},
    {text: 'currencyCode', code: true},
  ])
  assert.deepEqual(proseSpans('Template `\\`${a}\\`` and a \\` literal'), [
    {text: 'Template ', code: false},
    {text: '`${a}`', code: true},
    {text: ' and a ` literal', code: false},
  ])
  assert.deepEqual(proseSpans('Path `C:\\\\tools\\bin`'), [
    {text: 'Path ', code: false},
    {text: 'C:\\tools\\bin', code: true},
  ])
})

test('an unclosed backtick is literal, and plain prose drops markers', () => {
  assert.deepEqual(proseSpans('one ` two'), [{text: 'one ` two', code: false}])
  assert.deepEqual(proseSpans('`a` then ` open'), [
    {text: 'a', code: true},
    {text: ' then ` open', code: false},
  ])
  assert.equal(plainProse('Returns `Task<T>` instead of `T`'), 'Returns Task<T> instead of T')
  assert.deepEqual(proseSpans(''), [])
})

test('codeSpan and escapeProse escape so every text round-trips', () => {
  for (const text of ['plain', 'a`b', 'C:\\x', '``', '\\`', 'x\\']) {
    assert.deepEqual(proseSpans(codeSpan(text)), [{text, code: true}])
    assert.equal(plainProse(escapeProse(text)), text)
  }
})
