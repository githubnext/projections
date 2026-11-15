import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createNativeEngine} from '../dist/native.js'
import {ArtifactError, loadArtifact, maxArtifactBytes} from '../dist/artifacts/index.js'

const engine = createNativeEngine()
const extraction = {
  protocolVersion: 0,
  schema: 'graph/v0',
  entities: [
    {
      id: 'service',
      kind: 'service',
      label: 'Service',
      data: {value: 1},
      evidence: [{kind: 'source', source: 'service.py', location: {line: 1}}],
    },
  ],
  relationships: [],
}
const definition = {id: 'services', title: 'Services', renderer: 'graph', extractor: 'custom'}
const definitionDigest = `sha256:${'d'.repeat(64)}`
async function document(input = extraction, overrides = {}) {
  return {
    format: 'projections.extraction',
    version: 0,
    projection: {id: 'services', title: 'Services', renderer: 'graph'},
    extraction: await engine.normalize(input),
    digest: (await engine.canonicalize(input)).digest,
    provenance: {
      revision: {kind: 'commit', ref: 'a'.repeat(40), commit: 'a'.repeat(40), dirty: false},
      extractor: {id: 'custom', version: '1'},
      definition,
      definitionDigest,
      reproducibility: 'local',
      limitations: [],
      ...overrides,
    },
  }
}
async function comparisonDocument(before, after) {
  return {
    format: 'projections.comparison',
    version: 0,
    before,
    after,
    comparison: await engine.compare(before.extraction, after.extraction),
    comparator: await engine.defaultComparator(),
  }
}
const encode = value => JSON.stringify(value)
const rejects = (value, code) =>
  assert.rejects(loadArtifact(encode(value), {engine}), error => error instanceof ArtifactError && error.diagnostics[0].code === code)

test('real native engine verifies a saved extraction without losing evidence or provenance', async () => {
  const saved = await document()
  assert.deepEqual(await loadArtifact(encode(saved), {engine}), saved)
  const evidenceOnly = structuredClone(saved)
  evidenceOnly.extraction.entities[0].evidence[0].location.line = 2
  assert.deepEqual(
    (await loadArtifact(encode(evidenceOnly), {engine})).extraction.entities[0].evidence,
    evidenceOnly.extraction.entities[0].evidence,
  )
})

test('raw parser rejects duplicate keys, unsafe integers, invalid Unicode and excess nesting', async () => {
  const saved = await document()
  await assert.rejects(loadArtifact(encode(saved).replace('"version":0', '"version":0,"version":0'), {engine}))
  await assert.rejects(loadArtifact(encode(saved).replace('"value":1', '"value":9007199254740993'), {engine}))
  await assert.rejects(loadArtifact(encode(saved).replace('"Service"', '"\\ud800"'), {engine}))
  await assert.rejects(loadArtifact(`{"format":"projections.extraction","x":${'['.repeat(65)}0${']'.repeat(65)}}`, {engine}))
})

test('unknown fields, version 1 documents, malformed envelopes and invalid extractions fail explicitly', async () => {
  const saved = await document()
  await rejects({...saved, extra: true}, 'ARTIFACT_SCHEMA')
  await rejects({...saved, version: 1}, 'ARTIFACT_SCHEMA')
  await rejects({...saved, format: 'projections.snapshot'}, 'ARTIFACT_FORMAT')
  await rejects({...saved, digest: 'not-a-digest'}, 'ARTIFACT_SCHEMA')
  await rejects({...saved, digest: '0'.repeat(64)}, 'ARTIFACT_DIGEST')
  await rejects({...saved, projection: {...saved.projection, id: 'other'}}, 'ARTIFACT_PROVENANCE')
  await rejects({...saved, projection: {...saved.projection, title: 'Other'}}, 'ARTIFACT_PROVENANCE')
  await rejects({...saved, provenance: {...saved.provenance, extractor: {id: 'different', version: '1'}}}, 'ARTIFACT_PROVENANCE')
  await rejects({...saved, provenance: {...saved.provenance, definitionDigest: 'd'.repeat(64)}}, 'ARTIFACT_SCHEMA')
  await rejects({...saved, provenance: {...saved.provenance, revision: {...saved.provenance.revision, dirty: true}}}, 'ARTIFACT_SCHEMA')
  await rejects({...saved, provenance: {...saved.provenance, definition: {...definition, collector: 'custom'}}}, 'ARTIFACT_SCHEMA')
  await assert.rejects(
    loadArtifact(
      encode({...saved, extraction: {...saved.extraction, entities: [saved.extraction.entities[0], saved.extraction.entities[0]]}}),
      {engine},
    ),
  )
  await rejects(null, 'ARTIFACT_FORMAT')
  await rejects({format: 'unexpected'}, 'ARTIFACT_FORMAT')
})

test('comparison documents rerun the default comparator and reject tampered claims', async () => {
  const before = await document()
  const after = await document({...extraction, entities: [{...extraction.entities[0], label: 'Renamed label'}]})
  const saved = await comparisonDocument(before, after)
  assert.deepEqual(saved.comparison.changes, [
    {id: 'service', collection: 'entities', before: ['service'], after: ['service'], status: 'modified', correspondence: 'exact'},
  ])
  assert.deepEqual(await loadArtifact(encode(saved), {engine}), saved)
  const noticed = {...saved, notices: ['The head revision changes the definition of projection services.']}
  assert.deepEqual((await loadArtifact(encode(noticed), {engine})).notices, noticed.notices)
  await rejects({...saved, notices: ['']}, 'ARTIFACT_SCHEMA')
  await rejects({...saved, notices: 'one'}, 'ARTIFACT_SCHEMA')
  await rejects({...saved, notices: Array.from({length: 21}, (_, index) => `Notice ${index}`)}, 'ARTIFACT_SCHEMA')
  const objectOrder = structuredClone(saved)
  objectOrder.comparison = Object.fromEntries(Object.entries(objectOrder.comparison).reverse())
  assert.deepEqual((await loadArtifact(encode(objectOrder), {engine})).comparison, saved.comparison)
  await rejects({...saved, comparison: {...saved.comparison, changes: [], steps: []}}, 'ARTIFACT_COMPARISON')
  await rejects(
    {...saved, comparison: {...saved.comparison, changes: [{...saved.comparison.changes[0], summary: 'Forged explanation'}]}},
    'ARTIFACT_COMPARISON',
  )
  await rejects({...saved, comparison: {...saved.comparison, steps: [{...saved.comparison.steps[0], kind: 'add'}]}}, 'ARTIFACT_COMPARISON')
  await rejects(
    {...saved, comparison: {...saved.comparison, changes: [{...saved.comparison.changes[0], status: 'removed'}]}},
    'ARTIFACT_SCHEMA',
  )
  await rejects({...saved, comparator: {...saved.comparator, digest: `sha256:${'0'.repeat(64)}`}}, 'ARTIFACT_COMPARATOR')
  await rejects({...saved, comparator: {...saved.comparator, id: 'tools/compare.wasm'}}, 'ARTIFACT_COMPARATOR')
  const other = structuredClone(after)
  other.projection.id = other.provenance.definition.id = 'other'
  await rejects({...saved, after: other}, 'ARTIFACT_PROJECTION')
  const redefined = await document(after.extraction, {definitionDigest: `sha256:${'e'.repeat(64)}`})
  await rejects({...saved, after: redefined}, 'ARTIFACT_DEFINITION')
  // Presentation defaults are excluded from the definition digest and never block a comparison.
  const presented = await document(after.extraction, {definition: {...definition, presentation: {mode: 'swipe', durationMs: 4000}}})
  assert.deepEqual((await loadArtifact(encode({...saved, after: presented}), {engine})).after.provenance.definition.presentation, {
    mode: 'swipe',
    durationMs: 4000,
  })
  await rejects(
    {...saved, after: await document(after.extraction, {definition: {...definition, presentation: {mode: 'carousel'}}})},
    'ARTIFACT_SCHEMA',
  )
})

test('comparator options come from the shared definition', async () => {
  const options = {order: {by: 'dependents'}}
  const configured = {...definition, comparator: {options}}
  const before = await document(extraction, {definition: configured})
  const after = await document(
    {...extraction, entities: [...extraction.entities, {id: 'new', kind: 'service', label: 'New'}]},
    {definition: configured},
  )
  const saved = {
    ...(await comparisonDocument(before, after)),
    comparison: await engine.compare(before.extraction, after.extraction, options),
  }
  assert.deepEqual(await loadArtifact(encode(saved), {engine}), saved)
  // A comparison by a custom comparator is verified only with its comparator file.
  const custom = {...definition, comparator: 'tools/compare.comparator.yaml'}
  await rejects(
    {
      ...saved,
      before: {...before, provenance: {...before.provenance, definition: custom}},
      after: {...after, provenance: {...after.provenance, definition: custom}},
    },
    'ARTIFACT_COMPARATOR',
  )
  // Comparator modules are not a kind of comparator.
  const module = {...definition, comparator: {module: 'tools/compare.wasm'}}
  await rejects(
    {
      ...saved,
      before: {...before, provenance: {...before.provenance, definition: module}},
      after: {...after, provenance: {...after.provenance, definition: module}},
    },
    'ARTIFACT_SCHEMA',
  )
})

test('input limits count UTF-8 bytes and reject before invoking the parser', async () => {
  const neverCalled = {
    parseJson() {
      assert.fail('oversized input reached the parser')
    },
  }
  await assert.rejects(loadArtifact(' '.repeat(maxArtifactBytes + 1), {engine: neverCalled}), ArtifactError)
  await assert.rejects(loadArtifact('\u20ac'.repeat(Math.floor(maxArtifactBytes / 3) + 1), {engine: neverCalled}), ArtifactError)
  await assert.rejects(loadArtifact({}, {engine: neverCalled}), ArtifactError)
})

test('a comparison made by a custom comparator verifies only with its comparator file, rerun', async () => {
  const ruled = {...definition, comparator: {file: 'tools/order.comparator.yaml', options: {first: 'new'}}}
  const before = await document(extraction, {definition: ruled})
  const after = await document(
    {...extraction, entities: [...extraction.entities, {id: 'new', kind: 'service', label: 'New'}]},
    {definition: ruled},
  )
  const digest = `sha256:${'e'.repeat(64)}`
  const rules = new TextEncoder().encode('format: projections.comparator\nversion: 0\n')
  const calls = []
  const runtime = {
    async check(bytes) {
      assert.deepEqual(bytes, rules)
      return {digest}
    },
    async compare(bytes, input) {
      calls.push(input)
      return engine.compare(input.before, input.after)
    },
  }
  const saved = {
    ...(await comparisonDocument(before, after)),
    comparator: {id: 'tools/order.comparator.yaml', digest},
  }
  assert.deepEqual(await loadArtifact(encode(saved), {engine, rules: {bytes: rules, runtime}}), saved)
  assert.deepEqual(calls[0].options, {first: 'new'})
  // Without the comparator file it can't be verified; another file, or a forged result, is rejected.
  await rejects(saved, 'ARTIFACT_COMPARATOR')
  const code = async (value, supplied) => {
    try {
      await loadArtifact(encode(value), {engine, rules: supplied})
    } catch (error) {
      return error.diagnostics[0].code + ' ' + error.diagnostics[0].path
    }
    return 'verified'
  }
  assert.equal(
    await code({...saved, comparator: {...saved.comparator, digest: `sha256:${'0'.repeat(64)}`}}, {bytes: rules, runtime}),
    'ARTIFACT_COMPARATOR /comparator/digest',
  )
  assert.equal(
    await code({...saved, comparator: {...saved.comparator, id: 'other.comparator.yaml'}}, {bytes: rules, runtime}),
    'ARTIFACT_COMPARATOR /comparator/id',
  )
  const forged = structuredClone(saved)
  forged.comparison.changes[0].summary = 'Nothing to see here.'
  assert.equal(await code(forged, {bytes: rules, runtime}), 'ARTIFACT_COMPARISON /comparison')
  const failing = {...runtime, compare: async () => Promise.reject(new Error('out of fuel'))}
  assert.equal(await code(saved, {bytes: rules, runtime: failing}), 'ARTIFACT_RULES /comparator')
  const invalid = {...runtime, check: async () => Promise.reject(new Error('invalid rules'))}
  assert.equal(await code(saved, {bytes: rules, runtime: invalid}), 'ARTIFACT_RULES /comparator')
})
