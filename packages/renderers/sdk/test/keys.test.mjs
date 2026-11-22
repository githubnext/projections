import {test} from 'node:test'
import assert from 'node:assert/strict'
import {keyed} from '../dist/presentation.js'

test('keyed keys items by their text and their occurrence among equal ones', () => {
  assert.deepEqual(
    keyed(['a', 'b', 'a', 'a'], item => item).map(([key]) => key),
    ['a', 'b', 'a#2', 'a#3'],
  )
})

test('keyed keeps an item’s key when one is added before it', () => {
  const keys = items => keyed(items, item => item).map(([key]) => key)
  assert.deepEqual(keys(['x', 'y']), ['x', 'y'])
  assert.deepEqual(keys(['w', 'x', 'y']).slice(1), ['x', 'y'])
})
