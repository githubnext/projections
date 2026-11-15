import {test} from 'node:test'
import assert from 'node:assert/strict'
import {changeParts, changeTags, placeDetailCard, rowDetails, subjectRows} from '../dist/index.js'

const extraction = (entities, relationships = []) => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships})
const before = extraction(
  [
    {
      id: 'api',
      kind: 'service',
      label: 'API',
      data: {owner: 'web', ports: [80, 443], region: null},
      evidence: [{kind: 'source', source: 'src/api.ts', location: {line: 3}}],
    },
    {id: 'queue', kind: 'queue', label: 'Queue'},
    {id: 'legacy', kind: 'service', label: 'Legacy', data: {owner: 'ops'}, evidence: [{kind: 'source', source: 'src/legacy.ts'}]},
  ],
  [{id: 'calls', kind: 'calls', from: 'api', to: 'queue'}],
)
const after = extraction(
  [
    {
      id: 'api',
      kind: 'service',
      label: 'API',
      data: {owner: 'platform', ports: [443], tier: 'gold', region: null},
      evidence: [
        {kind: 'source', source: 'src/api.ts', location: {line: 5}},
        {kind: 'source', source: 'src/api.ts', location: {line: 5}},
      ],
    },
    {id: 'worker', kind: 'service', label: 'Worker', previousIds: ['queue']},
    {id: 'fresh', kind: 'service', label: 'Fresh', data: {owner: 'new', note: null}},
  ],
  [
    {id: 'calls', kind: 'calls', from: 'api', to: 'worker'},
    {id: 'feeds', kind: 'feeds', from: 'fresh', to: 'api'},
  ],
)
const comparison = {
  protocolVersion: 0,
  changes: [
    {
      id: 'api',
      collection: 'entities',
      before: ['api'],
      after: ['api'],
      status: 'modified',
      correspondence: 'exact',
      summary: 'Owner moved',
    },
    {id: 'worker', collection: 'entities', before: ['queue'], after: ['worker'], status: 'modified', correspondence: 'declared'},
    {id: 'legacy', collection: 'entities', before: ['legacy'], after: [], status: 'removed', correspondence: 'none'},
    {id: 'fresh', collection: 'entities', before: [], after: ['fresh'], status: 'added', correspondence: 'none'},
    {id: 'calls', collection: 'relationships', before: ['calls'], after: ['calls'], status: 'modified', correspondence: 'exact'},
    {id: 'feeds', collection: 'relationships', before: [], after: ['feeds'], status: 'added', correspondence: 'none'},
  ],
  steps: [{changes: ['api', 'worker', 'legacy', 'fresh', 'calls', 'feeds']}],
  metadata: {
    compatibility: {version: 0, changes: {api: {level: 'breaking', reason: 'Owner'}, fresh: {level: 'nonsense'}}},
    runtimePolicy: {interpretations: {api: ['scope-broadened', 7, 'scope-broadened'], legacy: 'coverage-lost'}},
  },
}
const subject = {mode: 'comparison', before, after, comparison}
const rows = subjectRows(subject)
const row = id => rows.find(item => item.id === id)

test('a modified item lists the fields that changed, old and new, without unset values', () => {
  const details = rowDetails(subject, row('api'), rows)
  assert.deepEqual(details.parts, [{hue: 'modified', label: 'Modified'}])
  assert.equal(details.summary, 'Owner moved')
  assert.deepEqual(
    details.fields.map(({name, before, after, path, side}) => ({name, before, after, path, side})),
    [
      {name: 'owner', before: 'web', after: 'platform', path: '/owner', side: 'after'},
      {name: 'ports', before: '[80,443]', after: '[443]', path: '/ports', side: 'after'},
      {name: 'tier', before: undefined, after: 'gold', path: '/tier', side: 'after'},
    ],
  )
  // The after side's evidence, once per location; the before side's file is the same, so it isn't repeated.
  assert.deepEqual(details.evidence, [{side: 'after', path: 'src/api.ts', line: 5}])
})

test('identity changes, additions and removals read as their own fields', () => {
  const renamed = rowDetails(subject, row('worker'), rows)
  assert.deepEqual(renamed.parts, [
    {hue: 'moved', label: 'Renamed'},
    {hue: 'modified', label: 'Modified'},
  ])
  assert.deepEqual(
    renamed.fields.map(field => [field.name, field.before, field.after]),
    [
      ['Identity', 'queue', 'worker'],
      ['Name', 'Queue', 'Worker'],
      ['Kind', 'queue', 'service'],
    ],
  )
  assert.deepEqual(
    rowDetails(subject, row('fresh'), rows).fields.map(field => [field.name, field.before, field.after, field.side]),
    [['owner', undefined, 'new', 'after']],
  )
  const removed = rowDetails(subject, row('legacy'), rows)
  assert.deepEqual(
    removed.fields.map(field => [field.name, field.before, field.after, field.side]),
    [['owner', 'ops', undefined, 'before']],
  )
  assert.deepEqual(removed.evidence, [{side: 'before', path: 'src/legacy.ts'}])
})

test('connections are an entity’s relationships, changed first, or a relationship’s endpoints', () => {
  const api = rowDetails(subject, row('api'), rows)
  assert.deepEqual(
    api.connections.map(({rowId, direction, label, kind}) => ({rowId, direction, label, kind})),
    [
      {rowId: 'calls', direction: 'outgoing', label: 'Worker', kind: 'calls'},
      {rowId: 'feeds', direction: 'incoming', label: 'Fresh', kind: 'feeds'},
    ],
  )
  assert.deepEqual(api.connections[1].parts, [{hue: 'added', label: 'Added'}])
  const calls = rowDetails(subject, row('calls'), rows)
  assert.deepEqual(
    calls.connections.map(({rowId, direction, label}) => ({rowId, direction, label})),
    [
      {rowId: 'api', direction: 'from', label: 'API'},
      {rowId: 'worker', direction: 'to', label: 'Worker'},
    ],
  )
  assert.equal(rowDetails(subject, row('api'), rows, {connections: 1}).moreConnections, 0)
})

test('classification tags come from comparator metadata conventions, ignoring anything malformed', () => {
  assert.deepEqual(changeTags(subject, 'api'), ['Breaking', 'Scope broadened'])
  assert.deepEqual(changeTags(subject, 'fresh'), [])
  assert.deepEqual(changeTags(subject, 'legacy'), [])
  assert.deepEqual(changeTags(subject, 'toString'), [])
  assert.deepEqual(changeTags({mode: 'extraction', extraction: after}, 'api'), [])
  assert.deepEqual(changeParts({status: 'unchanged', correspondence: 'exact'}), [])
})

test('one extraction lists the item’s set fields as they are', () => {
  const single = {mode: 'extraction', extraction: after}
  const singleRows = subjectRows(single)
  const details = rowDetails(
    single,
    singleRows.find(item => item.id === 'fresh'),
    singleRows,
  )
  assert.deepEqual(
    details.fields.map(field => [field.name, field.before, field.after]),
    [['owner', 'new', 'new']],
  )
  assert.deepEqual(details.parts, [])
})

const bounds = {x: 0, y: 100, width: 1200, height: 700}
const inside = (placement, height) =>
  placement.x >= bounds.x &&
  placement.y >= bounds.y &&
  placement.x + placement.width <= bounds.x + bounds.width &&
  placement.y + Math.min(height, placement.maxHeight) <= bounds.y + bounds.height

test('the card goes beside its anchor, flipping and shifting to stay inside the bounds', () => {
  const right = placeDetailCard({anchor: {x: 100, y: 200, width: 80, height: 30}, height: 300, bounds})
  assert.deepEqual([right.side, right.x, right.y, right.width], ['right', 188, 200, 320])
  const left = placeDetailCard({anchor: {x: 1000, y: 200, width: 150, height: 30}, height: 300, bounds})
  assert.deepEqual([left.side, left.x], ['left', 672])
  // Near the bottom, the card shifts up to stay in.
  const low = placeDetailCard({anchor: {x: 100, y: 760, width: 80, height: 30}, height: 300, bounds})
  assert.equal(low.y, 100 + 700 - 8 - 300)
  assert.ok(inside(low, 300))
  // A wide anchor leaves no room at either side: below, else above.
  const wide = {x: 20, y: 150, width: 1160, height: 40}
  assert.equal(placeDetailCard({anchor: wide, height: 300, bounds}).side, 'below')
  assert.equal(placeDetailCard({anchor: {...wide, y: 600}, height: 300, bounds}).side, 'above')
  const crowded = placeDetailCard({anchor: {...wide, y: 300, height: 300}, height: 300, bounds})
  assert.ok(inside(crowded, 300))
  // Without an anchor, the top end corner; taller than the bounds, it scrolls inside them.
  const over = placeDetailCard({anchor: null, height: 2000, bounds})
  assert.deepEqual([over.side, over.x, over.y, over.maxHeight], ['over', 1200 - 8 - 320, 108, 700 - 16])
})

test('narrow bounds get a bottom sheet across their width', () => {
  const sheet = placeDetailCard({
    anchor: {x: 10, y: 200, width: 80, height: 30},
    height: 300,
    bounds: {x: 0, y: 0, width: 390, height: 700},
  })
  assert.deepEqual(sheet, {sheet: true, side: 'below', x: 0, y: 400, width: 390, maxHeight: 420})
  const tall = placeDetailCard({anchor: null, height: 2000, bounds: {x: 0, y: 0, width: 390, height: 700}})
  assert.equal(tall.y, 700 - 420)
})
