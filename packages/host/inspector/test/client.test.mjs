import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createInspectorClient} from '../dist/ui/client/create.js'
import {isDevServerUrl} from '../dist/ui/client/guards.js'
import {parseComparatorResponse} from '../dist/ui/client/comparator.js'
import {parseFixtureCatalog} from '../dist/ui/client/fixtures.js'
import {parseRendererList} from '../dist/ui/client/renderers.js'
import {InspectorRequestError} from '../dist/ui/transport.js'
import {InspectorApp, artifactChoices} from '../dist/ui/index.js'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

/** A transport over a stand-in `fetch`, as a same-origin host's: the tests read the requests it makes. */
function fetchTransport(fetcher) {
  return {
    origin: 'http://127.0.0.1:1234',
    async request({method, path, body, signal, responseType}) {
      const response = await fetcher(new URL(path, 'http://127.0.0.1:1234'), {
        method,
        ...(signal ? {signal} : {}),
        ...(body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}),
      })
      if (!response.ok)
        throw new InspectorRequestError(
          `Local runner request failed (${response.status}): ${(await response.text()).slice(0, 2048)}`,
          response.status,
        )
      return responseType === 'blob' ? response.blob() : response.json()
    },
  }
}

test('requests carry no trust escalation payload, and refusals keep their status', async () => {
  const calls = []
  const client = createInspectorClient({
    transport: fetchTransport(async (url, init) => {
      calls.push({url: String(url), init})
      return new Response(JSON.stringify({id: 'job-1', status: 'running', outputs: [], diagnostics: []}))
    }),
  })
  await client.run({projectionId: 'architecture', before: 'HEAD~1', after: 'HEAD'})
  assert.equal(calls[0].url, 'http://127.0.0.1:1234/api/jobs')
  assert.equal(JSON.parse(calls[0].init.body).trust, undefined)
  const failed = createInspectorClient({transport: fetchTransport(async () => new Response('execution not authorized', {status: 403}))})
  await assert.rejects(() => failed.run({projectionId: 'x', before: 'HEAD'}), /403.*not authorized/)
})

test('offline Inspector renders as a local artifact inspector, not a working mocked extractor', () => {
  const markup = renderToStaticMarkup(
    createElement(InspectorApp, {
      engine: {},
      loadArtifact: async () => {
        throw new Error('unused')
      },
    }),
  )
  assert.ok(markup.includes('Offline inspection'))
  assert.ok(markup.includes('No runner is connected'))
  assert.ok(!markup.includes('Any ref'))
})

test('extraction jobs carry the definition revision and comparator requests are validated strictly', async () => {
  const calls = []
  const responses = [
    {id: 'job-1', status: 'running', outputs: [], diagnostics: []},
    {rules: btoa('format: x\n'), digest: `sha256:${'a'.repeat(64)}`},
    {default: true},
    {revisions: [{ref: 'working-tree', commit: 'c'.repeat(40), title: 'Working tree', kind: 'working-tree', dirty: true}]},
  ]
  const client = createInspectorClient({
    transport: fetchTransport(async (url, init) => {
      calls.push({url: new URL(url), init})
      return new Response(JSON.stringify(responses.shift()))
    }),
  })
  await client.run({projectionId: 'architecture', before: 'HEAD~1', definitionRevision: 'working-tree'})
  assert.deepEqual(JSON.parse(calls[0].init.body), {projectionId: 'architecture', before: 'HEAD~1', definitionRevision: 'working-tree'})
  const supplied = await client.comparator('architecture', 'HEAD')
  assert.equal(calls[1].url.pathname, '/api/comparator')
  assert.equal(calls[1].url.search, '?projection=architecture&ref=HEAD')
  assert.equal(supplied.kind, 'rules')
  assert.equal(new TextDecoder().decode(supplied.bytes), 'format: x\n')
  assert.deepEqual(await client.comparator('architecture'), {kind: 'default'})
  assert.equal(calls[2].url.search, '?projection=architecture')
  assert.equal((await client.revisions(undefined, 5)).revisions[0].dirty, true)
  assert.equal(calls[3].url.search, '?limit=5')
  await assert.rejects(() => client.revisions(undefined, 101), RangeError)
  const rules = parseComparatorResponse({rules: btoa('format: projections.comparator\n'), digest: `sha256:${'b'.repeat(64)}`})
  assert.equal(rules.kind, 'rules')
  assert.equal(new TextDecoder().decode(rules.bytes), 'format: projections.comparator\n')
  for (const invalid of [
    {default: false},
    {default: true, module: ''},
    {rules: '', digest: `sha256:${'a'.repeat(64)}`},
    {rules: 'AAAA', module: 'AAAA', digest: `sha256:${'a'.repeat(64)}`},
    // Comparator modules are no longer a kind of comparator.
    {module: 'AAAA', digest: `sha256:${'a'.repeat(64)}`},
    {rules: 'AAAA', digest: 'sha256:abc'},
    {rules: 'not base64!', digest: `sha256:${'a'.repeat(64)}`},
    {rules: 'AAAA', digest: `sha256:${'a'.repeat(64)}`, extra: 1},
  ]) {
    assert.throws(() => parseComparatorResponse(invalid), /comparator/)
  }
})

test('renderer lists are optional and custom renderer bases stay same-origin', async () => {
  const missing = createInspectorClient({
    transport: fetchTransport(async () => new Response('not found', {status: 404})),
  })
  assert.equal(await missing.renderers(), null)
  assert.deepEqual(parseRendererList({renderers: ['graph'], customRendererBase: '/renderers/custom/'}, 'http://127.0.0.1:1234'), {
    renderers: ['graph'],
    customRendererBase: 'http://127.0.0.1:1234/renderers/custom/',
  })
  assert.throws(
    () => parseRendererList({renderers: ['graph'], customRendererBase: 'https://example.com/'}, 'http://127.0.0.1:1234'),
    /same-origin/,
  )
  assert.throws(() => parseRendererList({renderers: ['../basic']}, 'http://127.0.0.1:1234'), /renderer list/)
  // The native runner lists renderer.json manifests.
  assert.deepEqual(
    parseRendererList(
      {renderers: [{format: 'projections.renderer', version: 0, name: 'graph', title: 'Graph', handles: []}]},
      'http://127.0.0.1:1234',
    ),
    {renderers: ['graph']},
  )
  assert.throws(() => parseRendererList({renderers: [{name: '../basic'}]}, 'http://127.0.0.1:1234'), /renderer list/)
})

test('renderer development servers are loopback http origins only', () => {
  for (const url of ['http://localhost:5173/', 'http://127.0.0.1:4000/']) assert.ok(isDevServerUrl(url), url)
  for (const url of [
    'http://[::1]:5173/',
    'https://localhost:5173/',
    'http://example.com:5173/',
    'http://localhost:5173/src/',
    'http://localhost:5173/?x',
    7,
  ])
    assert.ok(!isDevServerUrl(url), String(url))
  const catalog = renderer => ({generation: 1, sources: [], renderers: [renderer], scenarios: []})
  const manifest = {format: 'projections.renderer', version: 0, name: 'x', title: 'X', handles: []}
  assert.equal(
    parseFixtureCatalog(
      catalog({key: 'k', path: '/p', manifest, url: 'http://localhost:5173/', development: true}),
      'http://127.0.0.1:1234',
    ).renderers[0].url,
    'http://localhost:5173/',
  )
  assert.throws(
    () =>
      parseFixtureCatalog(
        catalog({key: 'k', path: '/p', manifest, url: 'https://example.com/', development: true}),
        'http://127.0.0.1:1234',
      ),
    /renderer URL/,
  )
  assert.throws(
    () => parseFixtureCatalog(catalog({key: 'k', path: '/p', manifest, url: 'http://localhost:5173/'}), 'http://127.0.0.1:1234'),
    /renderer URL/,
    'only development entries leave the Inspector origin',
  )
  // A bundle withheld for trust has no manifest or URL; one with a URL isn't withheld.
  const withheld = {key: 'k', path: '/p', withheld: 'Needs --trust.'}
  assert.equal(parseFixtureCatalog(catalog(withheld), 'http://127.0.0.1:1234').renderers[0].withheld, 'Needs --trust.')
  assert.throws(
    () => parseFixtureCatalog(catalog({...withheld, manifest, url: '/custom-renderers/c/fixtures/k/index.html'}), 'http://127.0.0.1:1234'),
    /renderer/,
  )
})

test('saved comparisons become a preselected pair of extractions', () => {
  const side = (commit, ref) => ({format: 'projections.extraction', provenance: {revision: {kind: 'commit', ref, commit, dirty: false}}})
  const {choices, before, after} = artifactChoices({
    format: 'projections.comparison',
    before: side('a'.repeat(40), 'HEAD~1'),
    after: side('b'.repeat(40), 'HEAD'),
  })
  assert.deepEqual(
    choices.map(choice => choice.label),
    ['Before · HEAD~1 · aaaaaaaa', 'After · HEAD · bbbbbbbb'],
  )
  assert.deepEqual([before, after], ['before', 'after'])
})

test('a hand-made comparison names each side by the file it was supplied in', () => {
  const supplied = path => ({
    format: 'projections.extraction',
    provenance: {
      revision: {kind: 'working-tree', ref: 'working-tree', commit: 'a'.repeat(40), dirty: true},
      reproducibility: 'unknown',
      limitations: [`Supplied as extractor output in ${path}; no extractor ran, so the revision names only the definition's.`],
    },
  })
  const {choices} = artifactChoices({
    format: 'projections.comparison',
    before: supplied('/tmp/a/raw-a.json'),
    after: supplied('raw-b.json'),
  })
  assert.deepEqual(
    choices.map(choice => choice.label),
    ['Before · raw-a.json', 'After · raw-b.json'],
  )
})

test('history sweeps start, read and fetch thumbnails as PNGs only', async () => {
  const calls = []
  const responses = [
    new Response(JSON.stringify({id: 'sweep-1', status: 'running'}), {status: 202}),
    new Response(JSON.stringify({sweep: null})),
    new Response(
      JSON.stringify({
        sweep: {id: 'sweep-1', status: 'completed', error: null, changes: [], projections: [], cells: []},
      }),
    ),
    new Response(new Uint8Array([137, 80, 78, 71]), {headers: {'content-type': 'image/png'}}),
    new Response('{}', {headers: {'content-type': 'application/json'}}),
  ]
  const client = createInspectorClient({
    transport: fetchTransport(async (url, init) => {
      calls.push({url: String(url), init})
      return responses.shift()
    }),
  })
  assert.deepEqual(await client.startSweep({last: 5, projections: ['prisma-schema']}), {id: 'sweep-1'})
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), {last: 5, projections: ['prisma-schema']})
  assert.equal(await client.sweep(), null)
  assert.equal((await client.sweep()).status, 'completed')
  const cell = {projection: 'prisma-schema', before: 'a1', after: 'b2'}
  assert.equal((await client.sweepThumbnail(cell)).size, 4)
  assert.equal(calls[3].url, 'http://127.0.0.1:1234/api/sweep/thumbnail?projection=prisma-schema&before=a1&after=b2')
  await assert.rejects(() => client.sweepThumbnail(cell), /invalid thumbnail/)
})

test('sweep columns summarize how often a projection changed and order by signal', async () => {
  const {columnStats, statsText, bySignal, signalCounts} = await import('../dist/ui/sweep/stats.js')
  const cell = (projection, after, changes) => ({
    projection,
    before: `${after}0`,
    after,
    status: changes === null ? 'failed' : changes ? 'changed' : 'unchanged',
    ...(changes === null ? {} : {changes, steps: changes ? 1 : 0}),
  })
  const changes = ['a', 'b', 'c', 'd', 'e']
  const cells = [
    ...changes.map(after => cell('files', after, 2)),
    ...changes.map((after, index) => cell('schema', after, index === 0 ? 7 : 0)),
    ...changes.map((after, index) => cell('deps', after, index < 2 ? 1 + index : 0)),
    ...changes.map(after => cell('quiet', after, 0)),
  ]
  assert.deepEqual(columnStats('files', cells), {swept: 5, changed: 5, failed: 0, median: 2, signal: 'noisy'})
  assert.equal(columnStats('schema', cells).signal, 'rare')
  assert.equal(columnStats('deps', cells).median, 1.5)
  assert.equal(columnStats('deps', cells).signal, 'steady')
  assert.equal(columnStats('quiet', cells).signal, 'quiet')
  // Too few changes to judge.
  assert.equal(columnStats('files', cells.slice(0, 3)).signal, 'unknown')
  assert.deepEqual(statsText(columnStats('files', cells)), {
    summary: 'Changed in 5 of 5 changes · median 2 changes',
    hint: 'Changes on nearly every change; may be noisy',
  })
  assert.equal(statsText(columnStats('schema', cells)).hint, 'Rarely changes; shows up for structural work')
  const rows = ['files', 'quiet', 'deps', 'schema', 'skipped'].map(projection => ({
    projection,
    status: projection === 'skipped' ? 'trust' : 'ready',
  }))
  assert.deepEqual(
    bySignal(rows, cells).map(row => row.projection),
    ['schema', 'deps', 'files', 'quiet', 'skipped'],
  )
  // Noisy projections don't count towards a change's signal.
  const counts = signalCounts({cells, projections: rows})
  assert.equal(counts.get('a'), 2)
  assert.equal(counts.get('b'), 1)
  assert.equal(counts.get('c'), undefined)
})

test('choices are named for people: the ref, the commit subject and age, never a bare commit when the runner knows it', async () => {
  const {choiceLabel} = await import('../dist/ui/index.js')
  const commit = 'e6e30acc' + 'a'.repeat(32)
  const document = kind => ({provenance: {revision: {kind, ref: 'x', commit, dirty: kind === 'working-tree'}}})
  const revisions = [{commit, title: 'Set up the workspaces', date: '2026-11-01T12:00:00Z'}]
  const now = Date.parse('2026-11-10T12:00:00Z')
  assert.equal(choiceLabel(commit, document('commit'), revisions, now), 'e6e30acc · "Set up the workspaces" · 9 days ago')
  assert.equal(choiceLabel('main', document('commit'), revisions, now), 'main · "Set up the workspaces" · 9 days ago')
  assert.equal(choiceLabel('main', document('commit'), [], now), 'main · e6e30acc')
  assert.equal(choiceLabel('working-tree', document('working-tree'), revisions, now), 'Working tree · uncommitted changes')
  // The working tree's entry shares HEAD's commit but not its subject; HEAD is named by its own.
  const withWorkingTree = [{ref: 'working-tree', kind: 'working-tree', commit, title: 'Working tree'}, ...revisions]
  assert.equal(choiceLabel('HEAD', document('commit'), withWorkingTree, now), 'HEAD · "Set up the workspaces" · 9 days ago')
})
