import {test} from 'node:test'
import assert from 'node:assert/strict'
import {keyed} from '../dist/presentation.js'

const keys = items => keyed(items, item => item).map(([key]) => key)

test('keyed keys items by their text and their occurrence among equal ones', () => {
  assert.deepEqual(keys(['a', 'b', 'a', 'a']), ['1:a', '1:b', '2:a', '3:a'])
})

test('keyed keeps an item’s key when one is added before it', () => {
  assert.deepEqual(keys(['x', 'y']), ['1:x', '1:y'])
  assert.deepEqual(keys(['w', 'x', 'y']).slice(1), ['1:x', '1:y'])
})

test('keyed never gives two items one key, even when their text looks like a key', () => {
  for (const items of [
    ['a', 'a', 'a#2'],
    ['a', 'a', '2:a'],
    ['1:a', 'a', '1:a'],
  ]) {
    assert.equal(new Set(keys(items)).size, items.length)
  }
})
