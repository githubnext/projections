import {test} from 'node:test'
import assert from 'node:assert/strict'
import {boundariesHoldingChanges} from '../dist/graph-canvas/holds-changes.js'

const node = (id, x, y, width, height, status = 'unchanged', group = false) => ({id, x, y, width, height, status, group, renamed: false})

test('a boundary with an emphasized changed card, boundary or link drawn inside it holds changes; others do not', () => {
  const outer = node('outer', 0, 0, 400, 300, 'modified', true)
  const inner = node('inner', -80, 0, 180, 200, 'unchanged', true)
  const changed = node('card', -80, 0, 100, 60, 'added')
  const elsewhere = node('away', 400, 0, 100, 60, 'removed')
  const quiet = node('quiet', 300, 300, 200, 200, 'modified', true)
  const emphasis = () => 1
  assert.deepEqual([...boundariesHoldingChanges([outer, inner, changed, elsewhere, quiet], [], emphasis)].toSorted(), ['inner', 'outer'])
  // A changed card that isn't emphasized yet (before its step) is drawn plain.
  assert.deepEqual([...boundariesHoldingChanges([outer, changed], [], row => (row.id === 'card' ? 0 : 1))], [])
  // A changed relationship routed inside the boundary counts too; an unchanged one doesn't.
  const link = status => ({
    id: 'link',
    status,
    renamed: false,
    points: [
      {x: -150, y: -100},
      {x: 150, y: 100},
    ],
  })
  assert.deepEqual([...boundariesHoldingChanges([outer], [link('added')], emphasis)], ['outer'])
  assert.deepEqual([...boundariesHoldingChanges([outer], [link('unchanged')], emphasis)], [])
})
