import {test} from 'node:test'
import assert from 'node:assert/strict'
import {paneArrangement} from '../dist/index.js'

const stage = {width: 1400, height: 700, stackBelow: 640}

test('a wide, short graph stacks; a tall or square one sits left and right', () => {
  assert.equal(paneArrangement({...stage, aspect: 6}), 'stacked')
  assert.equal(paneArrangement({...stage, aspect: 0.5}), 'columns')
  assert.equal(paneArrangement({...stage, aspect: 1}), 'columns')
})

test('narrow stages always stack, and without a shape or height the panes stay left and right', () => {
  assert.equal(paneArrangement({...stage, width: 500, aspect: 0.5}), 'stacked')
  assert.equal(paneArrangement({...stage, aspect: undefined}), 'columns')
  assert.equal(paneArrangement({...stage, height: 0, aspect: 6}), 'columns')
})

test('the current arrangement holds until the other one fits clearly larger', () => {
  // Around the break-even shape, either one holds; far from it, the better one wins.
  const even = [1, 1.5, 2, 2.5, 3, 4].find(aspect => paneArrangement({...stage, aspect}) === 'stacked')
  assert.ok(even)
  assert.equal(paneArrangement({...stage, aspect: even, current: 'columns'}), 'columns')
  assert.equal(paneArrangement({...stage, aspect: even, current: 'stacked'}), 'stacked')
  assert.equal(paneArrangement({...stage, aspect: 8, current: 'columns'}), 'stacked')
  assert.equal(paneArrangement({...stage, aspect: 0.4, current: 'stacked'}), 'columns')
})

test('panes that meet at a rule fit columns with the rule between them, not the gutter', () => {
  // Wide enough that the gutter tips it to stacked, and the 1px rule leaves it left and right.
  assert.equal(paneArrangement({...stage, aspect: 2.23}), 'stacked')
  assert.equal(paneArrangement({...stage, aspect: 2.23, columnGap: 1}), 'columns')
})

test('without label bands the panes fit the whole height', () => {
  // The bands' height tips this shape to columns; without them, stacked fits larger.
  assert.equal(paneArrangement({...stage, aspect: 2.1}), 'columns')
  assert.equal(paneArrangement({...stage, aspect: 2.1, band: 0}), 'stacked')
})
