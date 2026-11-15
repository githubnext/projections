import {test} from 'node:test'
import assert from 'node:assert/strict'

test('relationship labels use endpoint labels and a unicode arrow', async () => {
  const {entityLabels, relationshipLabel} = await import('../dist/presentation.js')
  const labels = entityLabels(
    {entities: [{id: 'api', kind: 'service', label: 'API'}]},
    {
      entities: [
        {id: 'api', kind: 'service', label: 'Old API'},
        {id: 'queue', kind: 'queue'},
      ],
    },
  )
  assert.equal(labels('api'), 'API')
  assert.equal(labels('queue'), 'queue')
  assert.equal(relationshipLabel({from: 'api', to: 'queue', kind: 'publishes'}, labels), 'API → queue (publishes)')
  assert.equal(relationshipLabel({from: 'api', to: 'queue', kind: 'Edge'}, labels), 'API → queue')
  assert.equal(relationshipLabel({from: 'x', to: 'y', kind: 'calls'}), 'x → y (calls)')
  assert.equal(relationshipLabel({from: 'api', to: 'queue', kind: 'publishes', label: 'Orders'}, labels), 'Orders')
})
