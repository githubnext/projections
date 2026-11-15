import {test} from 'node:test'
import assert from 'node:assert/strict'
import {describeChange, subjectRows} from '../dist/index.js'

const extraction = (entities, relationships) => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships})
const before = extraction(
  [
    {id: 'api', kind: 'service', label: 'API'},
    {id: 'queue', kind: 'queue', label: 'Orders queue'},
  ],
  [{id: 'api->queue', kind: 'publishes', from: 'api', to: 'queue'}],
)
const after = extraction(
  [
    {id: 'api', kind: 'service', label: 'Public API'},
    {id: 'queue', kind: 'queue', label: 'Orders queue'},
    {id: 'db', kind: 'database'},
  ],
  [
    {id: 'api->queue', kind: 'publishes', from: 'api', to: 'queue'},
    {id: 'api->db', kind: 'relationship', from: 'api', to: 'db'},
    {id: 'queue->db', kind: 'writes', from: 'queue', to: 'db', label: 'Persists orders'},
  ],
)

test('relationships are named by their endpoints with an arrow, and the kind when it says something', () => {
  const rows = subjectRows({mode: 'extraction', extraction: after})
  const label = id => rows.find(row => row.id === id).label
  assert.equal(label('api->queue'), 'Public API → Orders queue (publishes)')
  // A generic kind adds nothing; an endpoint without a label shows its ID.
  assert.equal(label('api->db'), 'Public API → db')
  // The relationship's own label wins.
  assert.equal(label('queue->db'), 'Persists orders')
})

test('a removed relationship is named from the before revision, and descriptions omit the raw ID', () => {
  const comparison = {
    protocolVersion: 0,
    comparator: {id: 'test', digest: 'x'},
    changes: [{id: 'c1', collection: 'relationships', status: 'removed', correspondence: 'exact', before: ['api->queue'], after: []}],
    steps: [{changes: ['c1']}],
  }
  const rows = subjectRows({mode: 'comparison', before, after: extraction(after.entities, []), comparison})
  const removed = rows.find(row => row.id === 'c1')
  assert.equal(removed.label, 'API → Orders queue (publishes)')
  assert.equal(describeChange(removed), 'Removed relationship API → Orders queue (publishes).')
  assert.ok(!describeChange(removed).includes('->'))
})
