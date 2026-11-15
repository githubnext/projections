import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import {createNativeEngine, EngineError, limits} from '../dist/native.js'
import {createWasmEngine} from '../dist/browser.js'

const bytes = await readFile(new URL('../artifacts/engine.wasm', import.meta.url))
const comparator = await readFile(new URL('../artifacts/default-comparator.wasm', import.meta.url))
for (const [name, engine] of [
  ['native', createNativeEngine()],
  ['wasm', await createWasmEngine({module: bytes}, {module: comparator})],
]) {
  test(`${name}: raw artifact bounds are independent of escaped transport size`, async () => {
    const value = {quotes: '"'.repeat(9 * 1024 * 1024)}
    const raw = JSON.stringify(value)
    const request = JSON.stringify({version: 0, operation: 'parse-json', json: raw})
    assert.ok(Buffer.byteLength(raw) < limits.artifactBytes)
    assert.ok(Buffer.byteLength(request) > 32 * 1024 * 1024)
    assert.ok(Buffer.byteLength(request) < limits.requestBytes)
    assert.deepEqual(await engine.parseJson(raw), value)
    const exact = '"' + 'x'.repeat(limits.artifactBytes - 2) + '"'
    assert.equal(Buffer.byteLength(exact), limits.artifactBytes)
    assert.equal((await engine.parseJson(exact)).length, limits.artifactBytes - 2)
    await assert.rejects(
      engine.parseJson('"' + 'x'.repeat(limits.artifactBytes) + '"'),
      error => error instanceof EngineError && error.diagnostics[0].code === 'json-size-limit',
    )
    await assert.rejects(
      engine.decode(' '.repeat(limits.extractionBytes) + '{}'),
      error => error instanceof EngineError && error.diagnostics[0].code === 'extraction-size-limit',
    )
    const empty = '{"protocolVersion":0,"schema":"graph/v0","entities":[],"relationships":[]}'
    assert.deepEqual(await engine.decode(empty + ' '.repeat(limits.extractionBytes - empty.length)), JSON.parse(empty))
    const nearLimit = {
      protocolVersion: 0,
      schema: 'graph/v0',
      entities: Array.from({length: 100}, (_, i) => ({id: String(i), kind: 'entity', label: String(i)})),
      relationships: [],
      metadata: {padding: ''},
    }
    nearLimit.metadata.padding = 'x'.repeat(limits.extractionBytes - Buffer.byteLength(JSON.stringify(nearLimit)) - 1)
    assert.ok(Buffer.byteLength(JSON.stringify(nearLimit)) < limits.extractionBytes)
    await assert.rejects(
      engine.normalize(nearLimit),
      error => error instanceof EngineError && error.diagnostics[0].code === 'extraction-size-limit',
    )
  })
}
