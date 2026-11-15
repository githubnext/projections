import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseRendererMessage, rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import {boundedLegend} from '../dist/index.js'

const valid = legend => parseRendererMessage({projections: 0, channel: 'c', type: 'legend', ...legend}, 'c') !== undefined

test('long legends fit the protocol', () => {
  const long = boundedLegend({title: 'Component kinds', items: [{label: 'module'}, {label: 'x'.repeat(200), token: 'chart-1'}]})
  assert.deepEqual(long.items[0], {label: 'module'})
  assert.equal(long.items[1].label.length, rendererLimits.legendLabel)
  assert.ok(valid(long))
  const many = boundedLegend({
    items: Array.from({length: 40}, (_, index) => ({label: `Language ${index}`, token: `chart-${(index % 16) + 1}`})),
  })
  assert.equal(many.items.length, rendererLimits.legendItems)
  assert.equal(many.items.at(-1).label, '17 more')
  assert.deepEqual(
    many.items.slice(0, -1).map(item => item.label),
    Array.from({length: 23}, (_, index) => `Language ${index}`),
  )
  assert.ok(valid(many))
})
