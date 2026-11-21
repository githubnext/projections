import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createNativeEngine} from '../dist/native.js'
import {browserHarness, graph} from './harness.mjs'
import {comparatorCases, engineCases} from '../test/vectors.mjs'

const native = createNativeEngine()
const corpus = JSON.parse(await readFile(new URL('../../../schemas/fixtures/conformance.json', import.meta.url), 'utf8'))
corpus.cases.push(...engineCases)
for (const engine of ['chromium', 'webkit']) {
  const harness = await browserHarness(engine)
  try {
    for (const test of corpus.cases) {
      const {operation, extraction, before, after, comparison, json} = test.request
      const method = {'parse-json': 'parseJson', 'validate-comparison': 'validateComparison'}[operation] ?? operation
      const args =
        operation === 'decode' || operation === 'parse-json'
          ? [json]
          : operation === 'validate-comparison'
            ? [before, after, comparison]
            : operation === 'vary' || operation === 'pair'
              ? [before, after]
              : operation === 'review'
                ? [comparison]
                : [extraction]
      let expected
      try {
        expected = {ok: true, result: await native[method](...args)}
      } catch (error) {
        expected = {ok: false, diagnostics: error.diagnostics}
        assert.ok(expected.diagnostics, error)
      }
      const actual = await harness.page.evaluate(
        async ({method, args}) => {
          try {
            return {ok: true, result: await globalThis.engine[method](...args)}
          } catch (error) {
            return {ok: false, diagnostics: error.diagnostics}
          }
        },
        {method, args},
      )
      assert.deepEqual(actual, expected, `${engine}: ${test.id}`)
      assert.equal(actual.ok, !test.expectError, test.id)
      const code = typeof test.expectError === 'string' ? test.expectError : test.expectedErrorCode
      if (code) assert.equal(actual.diagnostics[0].code, code, test.id)
      if (test.expectedErrorPath) assert.equal(actual.diagnostics[0].path, test.expectedErrorPath, test.id)
      if (test.expectedCanonical) assert.equal(actual.result.canonical, test.expectedCanonical)
      if (test.expectedResult) assert.deepEqual(actual.result, test.expectedResult, test.id)
    }
    console.log(`${engine}: ${corpus.cases.length} native/browser ABI cases agree`)
    const comparisons = [
      ...corpus.comparisons.map(item => ({...item, expectedErrorCode: item.expectError ? 'comparator-error' : undefined})),
      ...comparatorCases,
    ]
    for (const test of comparisons) {
      let expected
      try {
        expected = {ok: true, result: await native.compare(test.before, test.after, test.options)}
      } catch (error) {
        expected = {ok: false, diagnostics: error.diagnostics}
        assert.ok(expected.diagnostics, error)
      }
      const actual = await harness.page.evaluate(async ({before, after, options}) => {
        try {
          return {ok: true, result: await globalThis.engine.compare(before, after, options)}
        } catch (error) {
          return {ok: false, diagnostics: error.diagnostics}
        }
      }, test)
      assert.deepEqual(actual, expected, `${engine}: ${test.id}`)
      assert.equal(actual.ok, !test.expectedErrorCode, test.id)
      if (test.expected) assert.deepEqual(actual.result, test.expected, test.id)
    }
    console.log(`${engine}: ${comparisons.length} native/browser default comparator cases agree`)
    const workerResult = await harness.page.evaluate(async () => {
      const {createWorkerEngine} = await import('/dist/worker.js')
      const state = {protocolVersion: 0, schema: 'graph/v0', entities: [], relationships: []}
      const errors = []
      const error = async promise => {
        try {
          await promise
          return 'unexpected success'
        } catch (error) {
          return error.name + ': ' + error.message
        }
      }
      const engine = await createWorkerEngine()
      const canonical = await engine.canonicalize(state)
      const invalid = await error(engine.decode('{"x":1,"x":2}'))
      const envelope = await engine.parseJson('{"format":"projections.extraction","provenance":{"ref":"one"}}')
      const envelopeError = await error(engine.parseJson('{"format":"one","format":"two"}'))
      const pending = [engine.normalize(state), engine.canonicalize(state)]
      const settled = Promise.all(pending.map(error))
      engine.dispose()
      engine.dispose()
      errors.push(...(await settled), await error(engine.normalize(state)))
      const blob = source => URL.createObjectURL(new Blob([source], {type: 'text/javascript'}))
      const ready = '{type:"ready",digest:"sha256:' + '0'.repeat(64) + '"}'
      const hang = blob('onmessage = e => { if(e.data.type === "init") postMessage(' + ready + ') }')
      const crash = blob('onmessage = e => { if(e.data.type === "init") postMessage(' + ready + '); else throw Error("worker crash") }')
      const malformed = blob(
        'onmessage = e => postMessage(e.data.type === "init" ? ' + ready + ' : {type:"response",id:e.data.id,bytes:new Uint8Array([0])})',
      )
      const neverReady = blob('onmessage = () => {}')
      try {
        for (const workerUrl of [hang, crash, malformed]) {
          const worker = await createWorkerEngine({workerUrl, timeoutMs: 1000})
          errors.push(...(await Promise.all([worker.normalize(state), worker.canonicalize(state)].map(error))))
          worker.dispose()
        }
        errors.push(await error(createWorkerEngine({workerUrl: neverReady, timeoutMs: 100})))
        errors.push(await error(createWorkerEngine({workerUrl: '/missing-worker.js', timeoutMs: 1000})))
        errors.push(await error(createWorkerEngine({wasm: {url: '/missing.wasm'}})))
        errors.push(await error(createWorkerEngine({comparator: {url: '/missing.wasm'}})))
      } finally {
        for (const url of [hang, crash, malformed, neverReady]) URL.revokeObjectURL(url)
      }
      return {canonical, invalid, envelope, envelopeError, errors}
    })
    assert.deepEqual(
      workerResult.canonical,
      await native.canonicalize({protocolVersion: 0, schema: 'graph/v0', entities: [], relationships: []}),
    )
    assert.match(workerResult.invalid, /^EngineError: duplicate-key/)
    assert.deepEqual(workerResult.envelope, {format: 'projections.extraction', provenance: {ref: 'one'}})
    assert.match(workerResult.envelopeError, /^EngineError: duplicate-key/)
    for (const error of workerResult.errors) assert.match(error, /^EngineTransportError:/)
    console.log(`${engine}: Worker disposal, pending rejection, crash, timeout and initialization failures pass`)
    const large = graph(10000, 50000)
    const expected = await native.compare(large, large)
    const responsive = await harness.page.evaluate(async state => {
      const {createWorkerEngine} = await import('/dist/worker.js')
      const engine = await createWorkerEngine()
      let heartbeats = 0
      const interval = setInterval(() => heartbeats++, 10)
      try {
        const comparison = await engine.compare(state, state)
        return {comparison, heartbeats}
      } finally {
        clearInterval(interval)
        engine.dispose()
      }
    }, large)
    assert.deepEqual(responsive.comparison, expected)
    assert.ok(responsive.heartbeats >= 5, `${engine}: main-thread heartbeat during limit-sized comparison`)
    console.log(`${engine}: Worker 10k/50k comparison agrees; ${responsive.heartbeats} UI heartbeats while pending`)
    const document = JSON.stringify({
      format: 'projections.comparison',
      version: 0,
      before: {extraction: large},
      after: {extraction: large},
      comparison: expected,
      // Quotes double in size when the document is itself escaped into a request.
      padding: '"'.repeat(6 * 1024 * 1024),
    })
    const requestBytes = Buffer.byteLength(JSON.stringify({version: 0, operation: 'parse-json', json: document}))
    assert.ok(Buffer.byteLength(document) < 32 * 1024 * 1024)
    assert.ok(requestBytes > 32 * 1024 * 1024)
    const parsedNative = await native.parseJson(document)
    const parsedBrowser = await harness.page.evaluate(async document => {
      const {createWorkerEngine} = await import('/dist/worker.js')
      const engine = await createWorkerEngine()
      try {
        return await engine.parseJson(document)
      } finally {
        engine.dispose()
      }
    }, document)
    assert.deepEqual(parsedBrowser, parsedNative)
    console.log(`${engine}: ${Buffer.byteLength(document)}-byte artifact parses strictly despite ${requestBytes}-byte transport`)
  } finally {
    await harness.close()
  }
}
