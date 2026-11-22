import assert from 'node:assert/strict'
import {readFile, readdir} from 'node:fs/promises'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {chromium, webkit} from 'playwright'
import {createNativeEngine} from '../dist/native.js'

const engine = createNativeEngine()
const initial = {protocolVersion: 0, schema: 'graph/v0', entities: [{id: 'service', kind: 'service', label: 'Before'}], relationships: []}
async function extraction(input) {
  const normalized = await engine.normalize(input)
  return {
    format: 'projections.extraction',
    version: 0,
    projection: {id: 'service', title: 'Service', renderer: 'graph'},
    extraction: normalized,
    digest: (await engine.canonicalize(normalized)).digest,
    provenance: {
      revision: {kind: 'commit', ref: 'a'.repeat(40), commit: 'a'.repeat(40), dirty: false},
      extractor: {id: 'custom', version: '1'},
      definition: {id: 'service', title: 'Service', renderer: 'graph', extractor: 'custom'},
      definitionDigest: `sha256:${'d'.repeat(64)}`,
      reproducibility: 'local',
      limitations: [],
    },
  }
}
const before = await extraction(initial)
const after = await extraction({...initial, entities: [{...initial.entities[0], label: 'After'}]})
const comparison = {
  format: 'projections.comparison',
  version: 0,
  before,
  after,
  comparison: await engine.compare(before.extraction, after.extraction),
  comparator: await engine.defaultComparator(),
}
const assets = new Map([
  ['/', {type: 'text/html', body: '<!doctype html><title>Artifact CSP conformance</title><script type="module" src="/test.js"></script>'}],
  ['/fixture.json', {type: 'application/json', body: JSON.stringify({before, comparison})}],
  [
    '/test.js',
    {
      type: 'text/javascript',
      body: `
    import {loadArtifact} from '/artifacts/index.js'
    import {createWorkerEngine} from '/engine/dist/worker.js'
    window.runArtifactChecks = async () => {
      const engine = await createWorkerEngine()
      try {
        const fixture = await (await fetch('/fixture.json')).json()
        const extraction = await loadArtifact(JSON.stringify(fixture.before), {engine})
        const compared = await loadArtifact(JSON.stringify(fixture.comparison), {engine})
        const failures = []
        const invalid = structuredClone(fixture.comparison)
        invalid.comparison.changes[0].status = 'unchanged'
        const duplicate = JSON.stringify(fixture.before).replace('"version":0', '"version":0,"version":0')
        for (const json of [JSON.stringify(invalid), duplicate]) {
          try { await loadArtifact(json, {engine}); failures.push(false) }
          catch (error) { failures.push(Array.isArray(error.diagnostics) && error.diagnostics.length > 0) }
        }
        return {extraction, compared, failures}
      } finally { engine.dispose() }
    }
  `,
    },
  ],
])
// Served as a bundler would resolve them: the artifacts module's schemas dependency from its package.
const schemas = new URL('./', import.meta.resolve('@githubnext/projections-schemas'))
for (const [prefix, directory] of [
  ['/artifacts/', new URL('../dist/artifacts/', import.meta.url)],
  ['/engine/dist/', new URL('../dist/', import.meta.url)],
  ['/schemas/', schemas],
]) {
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.js'))) {
    const body = (await readFile(new URL(file, directory), 'utf8')).replaceAll("'@githubnext/projections-schemas'", "'/schemas/index.js'")
    assets.set(`${prefix}${file}`, {type: 'text/javascript', body})
  }
}
for (const name of ['engine.wasm', 'default-comparator.wasm']) {
  assets.set(`/engine/artifacts/${name}`, {
    type: 'application/wasm',
    body: await readFile(new URL(`../artifacts/${name}`, import.meta.url)),
  })
}
const server = createServer((request, response) => {
  const asset = assets.get(request.url)
  response.setHeader(
    'content-security-policy',
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
  )
  response.setHeader('x-content-type-options', 'nosniff')
  if (!asset) {
    response.writeHead(404)
    response.end()
    return
  }
  response.setHeader('content-type', asset.type)
  response.end(asset.body)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
try {
  for (const [name, browserType] of [
    ['Chromium', chromium],
    ['WebKit', webkit],
  ]) {
    const browser = await browserType.launch({headless: true})
    try {
      const page = await browser.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${server.address().port}/`)
      await page.waitForFunction(() => typeof window.runArtifactChecks === 'function')
      const result = await page.evaluate(() => window.runArtifactChecks())
      assert.deepEqual(result.extraction, before)
      assert.deepEqual(result.compared, comparison)
      assert.deepEqual(result.failures, [true, true])
      assert.deepEqual(errors, [])
      console.log(`${name}: actual Wasm Worker artifact loading, forgery/raw rejection and strict CSP pass`)
    } finally {
      await browser.close()
    }
  }
} finally {
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
}
