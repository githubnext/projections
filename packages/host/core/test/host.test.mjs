import {test} from 'node:test'
import assert from 'node:assert/strict'
import {rendererContentSecurityPolicy as sdkPolicy} from '@githubnext/projections-renderer-sdk/protocol'
import {rendererContentSecurityPolicy as buildPolicy, rendererResponseHeaders} from '../build/collect-renderers.mjs'
import {
  ComparisonError,
  builtinRendererDocuments,
  compatibleRenderers,
  computeComparison,
  describeChange,
  resolveRenderer,
  subjectRows,
} from '../dist/index.js'

const extraction = (entities, relationships = []) => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships})
const before = extraction(
  [
    {id: 'a', kind: 'service', label: 'API'},
    {id: 'b', kind: 'queue', label: 'Queue'},
  ],
  [{id: 'e', kind: 'calls', from: 'a', to: 'b'}],
)
const after = extraction(
  [
    {id: 'a', kind: 'service', label: 'API'},
    {id: 'c', kind: 'service', label: 'Worker', previousIds: ['b']},
  ],
  [{id: 'e', kind: 'calls', from: 'a', to: 'c'}],
)
const comparison = {
  protocolVersion: 0,
  changes: [
    {
      id: 'c',
      collection: 'entities',
      before: ['b'],
      after: ['c'],
      status: 'modified',
      correspondence: 'declared',
      summary: 'Queue became a worker',
    },
    {id: 'e', collection: 'relationships', before: ['e'], after: ['e'], status: 'modified', correspondence: 'exact'},
  ],
  steps: [{changes: ['c'], kind: 'restructure'}, {changes: ['e']}],
}
const definition = {id: 'p', extractor: 'x', renderer: 'graph'}
const document = (value, overrides = {}) => ({
  format: 'projections.extraction',
  version: 0,
  projection: {id: 'p', title: 'P', renderer: 'graph'},
  extraction: value,
  provenance: {
    revision: {kind: 'commit', ref: 'main', commit: '0'.repeat(40), dirty: false},
    extractor: {id: 'x', version: '1'},
    definition,
    definitionDigest: 'sha256:1',
    reproducibility: 'local',
    limitations: [],
    ...overrides,
  },
  digest: '0'.repeat(64),
})

test('the renderer policy is identical for serving layers and forbids every request', () => {
  assert.equal(buildPolicy, sdkPolicy)
  assert.match(sdkPolicy, /connect-src 'none'/)
  assert.match(sdkPolicy, /sandbox allow-scripts/)
  assert.doesNotMatch(sdkPolicy, /'self'/)
  assert.equal(rendererResponseHeaders('x/index.html')['content-security-policy'], sdkPolicy)
  assert.equal(rendererResponseHeaders('x/index.html')['x-content-type-options'], 'nosniff')
})

test('rows list changes in step order, then unchanged items, with plain-language descriptions', () => {
  const rows = subjectRows({mode: 'comparison', before, after, comparison})
  assert.deepEqual(
    rows.map(row => [row.id, row.status, row.step]),
    [
      ['c', 'modified', 0],
      ['e', 'modified', 1],
      ['a', 'unchanged', undefined],
    ],
  )
  assert.equal(describeChange(rows[0]), 'Modified entity Worker [`c`] (was `b`): Queue became a worker.')
  assert.deepEqual(
    subjectRows({mode: 'extraction', extraction: after}).map(row => row.id),
    ['a', 'c', 'e'],
  )
})

test('renderer resolution prefers an exact bundle name, then handles, and explains a missing renderer', () => {
  const catalog = [
    {
      name: 'graph',
      title: 'Graph',
      handles: ['graph', 'graph-horizontal', 'dag'],
      url: 'https://h/renderers/graph/index.html',
      source: 'builtin',
    },
    {name: 'dag', title: 'DAG', handles: [], url: 'https://h/renderers/dag/index.html', source: 'builtin'},
  ]
  assert.equal(resolveRenderer('dag', catalog).renderer?.name, 'dag')
  assert.equal(resolveRenderer('graph-horizontal', catalog).renderer?.name, 'graph')
  assert.match(resolveRenderer('flags', catalog).notice, /"flags" is not available/)
  assert.match(resolveRenderer({bundle: 'r/dist'}, catalog).notice, /custom renderer r\/dist is not available.*built-in table view/)
  // A custom renderer that isn't supplied falls back to the built-in renderer for the extraction's schema.
  const fallback = resolveRenderer({bundle: 'r/dist'}, catalog, undefined, 'dag/v0')
  assert.equal(fallback.renderer?.name, 'dag')
  assert.match(fallback.notice, /custom renderer r\/dist is not available here\. Showing the built-in DAG renderer instead\./)
  const withheld = resolveRenderer({bundle: 'r/dist'}, catalog, {withheld: 'It needs trust.'}, 'graph/v0')
  assert.equal(withheld.renderer?.name, 'graph')
  assert.equal(withheld.notice, 'It needs trust. Showing the built-in Graph renderer instead.')
  assert.equal(
    resolveRenderer({bundle: 'r/dist'}, catalog, {withheld: 'It needs trust.'}, 'api/v0').notice,
    'It needs trust. Showing the built-in table view.',
  )
  const custom = {name: 'custom', title: 'Custom', handles: [], url: 'https://h/custom/index.html', source: 'custom'}
  assert.equal(resolveRenderer({bundle: 'r/dist'}, catalog, custom, 'graph/v0').renderer, custom)
})

test('a renderer that declares what it accepts is not given other extractions: the notice says what it presents', () => {
  const entry = (name, title, accepts, handles = [name]) => ({
    name,
    title,
    handles,
    url: `https://h/${name}/index.html`,
    source: 'builtin',
    ...(accepts ? {accepts} : {}),
  })
  const catalog = [
    entry('graph', 'Graph', [{schema: 'graph/v0'}, {schema: 'architecture/v0'}], ['graph', 'architecture']),
    entry('database', 'Database', [{schema: 'database/v0'}]),
    entry('dependency-injection', 'Dependency injection', [{schema: 'architecture/v0', vocabulary: 'dependency-injection/v0'}]),
    entry('anything', 'Anything', undefined),
  ]
  const di = {schema: 'architecture/v0', vocabularies: ['dependency-injection/v0']}
  assert.equal(resolveRenderer('dependency-injection', catalog, undefined, di).renderer?.name, 'dependency-injection')
  assert.equal(resolveRenderer('database', catalog, undefined, {schema: 'database/v0'}).renderer?.name, 'database')
  assert.equal(resolveRenderer('anything', catalog, undefined, {schema: 'metrics/v0'}).renderer?.name, 'anything')
  // Without the vocabulary, the DI renderer isn't used: the architecture graph is, and the notice says why.
  const plain = resolveRenderer('dependency-injection', catalog, undefined, {schema: 'architecture/v0'})
  assert.equal(plain.renderer?.name, 'graph')
  assert.equal(
    plain.notice,
    'The Dependency injection renderer presents `architecture/v0` with `dependency-injection/v0`; this extraction is `architecture/v0`. Showing the built-in Graph renderer instead.',
  )
  const wrong = resolveRenderer('database', catalog, undefined, {schema: 'metrics/v0'})
  assert.equal(wrong.renderer, undefined)
  assert.equal(
    wrong.notice,
    'The Database renderer presents `database/v0`; this extraction is `metrics/v0`. Showing the built-in table view.',
  )
  const custom = {...entry('custom', 'Flags', [{schema: 'graph/v0'}]), source: 'custom'}
  assert.match(
    resolveRenderer({bundle: 'r/dist'}, catalog, custom, {schema: 'database/v0'}).notice,
    /^The Flags renderer presents \x60graph\/v0\x60.*built-in Database renderer instead\.$/,
  )
  // Unchecked without an extraction, and a schema name alone checks only the schema.
  assert.equal(resolveRenderer('database', catalog).renderer?.name, 'database')
  assert.equal(resolveRenderer('dependency-injection', catalog, undefined, 'architecture/v0').renderer?.name, 'dependency-injection')
  // Choices leave out renderers that don't accept the extraction and add those that declare they do.
  const documentOf = (renderer, payload) => ({projection: {id: 'p', title: 'P', renderer}, extraction: payload})
  assert.deepEqual(
    compatibleRenderers(documentOf('graph', {...di, entities: [], relationships: []}), catalog).map(item => item.name),
    ['graph', 'dependency-injection'],
  )
  assert.deepEqual(
    compatibleRenderers(documentOf('dependency-injection', {schema: 'architecture/v0', entities: [], relationships: []}), catalog).map(
      item => item.name,
    ),
    ['graph'],
  )
})

const engine = {
  calls: [],
  /** The engine's answer to `pair`, which tests set: this fake never decides pairing itself. */
  pairing: {pairing: 'same'},
  async pair() {
    return this.pairing
  },
  async compare(b, a, options) {
    this.calls.push(['compare', options])
    return comparison
  },
  async defaultComparator() {
    return {id: 'default', digest: 'sha256:default'}
  },
  async validateComparison(b, a, value) {
    this.calls.push(['validate'])
    if (value.invalid) throw Object.assign(new Error('bad'), {diagnostics: [{path: '/steps', message: 'missing change'}]})
    return value
  },
}

test('comparisons require the engine to pair the extractions, and explain a mismatch', async () => {
  const compare = pairing => {
    engine.pairing = pairing
    return computeComparison({engine, before: document(before), after: document(after), comparator: {kind: 'default'}})
  }
  try {
    await assert.rejects(
      compare({pairing: 'projection'}),
      error => error instanceof ComparisonError && error.code === 'projection-mismatch',
    )
    await assert.rejects(
      compare({pairing: 'definition', differing: ['inputs', 'execution']}),
      error => error.code === 'definition-mismatch' && error.details.join(' ') === 'The inputs differs. The execution settings differs.',
    )
    await assert.rejects(
      compare({pairing: 'components'}),
      error =>
        error.code === 'definition-mismatch' &&
        error.details[0] === 'The definitions are identical, so the content of their declared component sources differs.',
    )
  } finally {
    engine.pairing = {pairing: 'same'}
  }
})

test('the default comparator runs with the definition options; a module runs on the baseline and is validated', async () => {
  const options = {order: {by: 'dependents'}}
  const withOptions = {...definition, comparator: {options}}
  engine.calls = []
  const defaultComparison = await computeComparison({
    engine,
    before: document(before, {definition: withOptions}),
    after: document(after, {definition: withOptions}),
    comparator: {kind: 'default'},
  })
  assert.deepEqual(defaultComparison.comparator, {id: 'default', digest: 'sha256:default'})
  assert.deepEqual(engine.calls, [['compare', options]])

  const rulesDefinition = {...definition, comparator: {file: 'tools/compare.comparator.yaml', options: {priority: ['c']}}}
  const bytes = new TextEncoder().encode('format: projections.comparator\nversion: 0\n')
  const digest = 'sha256:rules'
  const docs = {before: document(before, {definition: rulesDefinition}), after: document(after, {definition: rulesDefinition})}
  /** A rules runtime that identifies every file by `digest` and answers `compare`. */
  const runtime = (compare, check = async () => ({digest})) => ({check, compare})
  let input
  engine.calls = []
  const custom = await computeComparison({
    engine,
    ...docs,
    comparator: {kind: 'rules', id: 'tools/compare.comparator.yaml', bytes, digest},
    rules: runtime(async (rulesBytes, value) => {
      assert.equal(rulesBytes, bytes)
      input = value
      return {...comparison, metadata: {custom: true}}
    }),
  })
  assert.deepEqual(custom.comparator, {id: 'tools/compare.comparator.yaml', digest})
  assert.deepEqual(input.options, {priority: ['c']})
  // The rules interpreter computes the default baseline itself.
  assert.deepEqual(input.baseline, {})
  assert.deepEqual(engine.calls, [['validate']])

  await assert.rejects(
    computeComparison({
      engine,
      ...docs,
      comparator: {kind: 'rules', id: 'x', bytes, digest: 'sha256:00'},
      rules: runtime(async () => comparison),
    }),
    error => error.code === 'comparator-digest-mismatch',
  )
  await assert.rejects(
    computeComparison({
      engine,
      ...docs,
      comparator: {kind: 'rules', id: 'x', bytes, digest},
      rules: runtime(
        async () => comparison,
        async () => {
          throw new Error('Line 2: nope')
        },
      ),
    }),
    error => error.code === 'comparator-failed' && /is invalid: Line 2/.test(error.message),
  )
  await assert.rejects(
    computeComparison({
      engine,
      ...docs,
      comparator: {kind: 'rules', id: 'x', bytes, digest},
      rules: runtime(async () => {
        throw new Error('trap')
      }),
    }),
    error => error.code === 'comparator-failed' && /trap/.test(error.message),
  )
  await assert.rejects(
    computeComparison({
      engine,
      ...docs,
      comparator: {kind: 'rules', id: 'x', bytes, digest},
      rules: runtime(async () => ({invalid: true})),
    }),
    error => error.code === 'invalid-comparison' && error.details[0] === '/steps: missing change',
  )
  await assert.rejects(
    computeComparison({engine, ...docs, comparator: {kind: 'rules', id: 'x', bytes, digest}}),
    error => error.code === 'comparator-unavailable',
  )
  await assert.rejects(
    computeComparison({engine, ...docs, comparator: {kind: 'default'}}),
    error => error.code === 'comparator-unavailable',
  )
})

test('hosts supply built-in renderer documents by name from their own catalog, and refuse anything else', async () => {
  const fetched = []
  let failNext = true
  const fetcher = async (url, init) => {
    fetched.push([String(url), init.credentials, init.redirect])
    if (failNext) {
      failNext = false
      return {ok: false, status: 503}
    }
    return {ok: true, text: async () => `<!doctype html><title>${new URL(url).pathname}</title>`}
  }
  const entry = (name, source, extra = {}) => ({
    name,
    title: name,
    handles: name === 'graph' ? ['graph', 'dag'] : [name],
    url: `https://host.example/renderers/${name}/index.html`,
    source,
    ...extra,
  })
  const documents = builtinRendererDocuments(
    [entry('graph', 'builtin'), entry('database', 'builtin', {document: async () => 'rewritten'}), entry('mine', 'custom')],
    fetcher,
  )
  await assert.rejects(documents('graph'), /Renderer request failed \(503\)/)
  assert.equal(await documents('graph'), '<!doctype html><title>/renderers/graph/index.html</title>')
  assert.equal(await documents('graph'), '<!doctype html><title>/renderers/graph/index.html</title>')
  assert.deepEqual(fetched, [
    ['https://host.example/renderers/graph/index.html', 'omit', 'error'],
    ['https://host.example/renderers/graph/index.html', 'omit', 'error'],
  ])
  assert.equal(await documents('dag'), await documents('graph'), 'a name the bundle handles')
  assert.equal(await documents('database'), 'rewritten', "an entry's own document wins")
  await assert.rejects(documents('mine'), /mine is a custom renderer; hosts supply only built-in renderers/)
  await assert.rejects(documents('missing'), /missing is not a built-in renderer/)
  await assert.rejects(documents('../graph/index.html'), /is not a built-in renderer/)
  assert.equal(fetched.length, 2)
})
