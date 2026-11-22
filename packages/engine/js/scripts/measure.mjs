import assert from 'node:assert/strict'
import {readFile, stat} from 'node:fs/promises'
import {gzipSync} from 'node:zlib'
import {platform, arch, cpus} from 'node:os'
import {createNativeEngine} from '../dist/native.js'
import {browserHarness, graph} from './harness.mjs'

const native = createNativeEngine()
const harness = await browserHarness()
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const output = {
  environment: {node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0].model, browser: harness.browser.version()},
  artifacts: {
    nativeBytes: (await stat(new URL('../artifacts/native/projections-engine', import.meta.url))).size,
    wasmBytes: (await stat(new URL('../artifacts/engine.wasm', import.meta.url))).size,
    wasmGzipBytes: gzipSync(await readFile(new URL('../artifacts/engine.wasm', import.meta.url))).length,
    browserStartupMs: harness.startupMs,
  },
  samples: [],
}
try {
  for (const [entities, relationships, repetitions] of [
    [1000, 5000, 5],
    [10000, 50000, 1],
  ]) {
    const before = graph(entities, relationships)
    const after = structuredClone(before)
    after.entities[0].id = 'service:renamed'
    after.entities[0].previousIds = [before.entities[0].id]
    after.entities[0].data.size = 999
    for (const relationship of after.relationships) {
      if (relationship.from === before.entities[0].id) relationship.from = after.entities[0].id
      if (relationship.to === before.entities[0].id) relationship.to = after.entities[0].id
    }
    const sample = {entities, relationships, extractionBytes: Buffer.byteLength(JSON.stringify(before)), repetitions, operations: {}}
    for (const [operation, args] of [
      ['decode', [JSON.stringify(before)]],
      ['normalize', [before]],
      ['canonicalize', [before]],
      ['compare', [before, after]],
    ]) {
      const nativeTimes = []
      const wasmTimes = []
      let nativeResult
      let wasmResult
      for (let i = 0; i < repetitions; i++) {
        const start = performance.now()
        nativeResult = await native[operation](...args)
        nativeTimes.push(performance.now() - start)
        const browser = await harness.page.evaluate(
          async request => {
            const browserStart = performance.now()
            const result = await globalThis.engine[request.operation](...request.args)
            return {result, ms: performance.now() - browserStart}
          },
          {operation, args},
        )
        wasmResult = browser.result
        wasmTimes.push(browser.ms)
        assert.deepEqual(wasmResult, nativeResult, `${entities}/${relationships} ${operation}`)
      }
      sample.operations[operation] = {
        nativeMedianMs: median(nativeTimes),
        wasmMedianMs: median(wasmTimes),
        responseBytes: Buffer.byteLength(JSON.stringify(nativeResult)),
        agreement: true,
      }
    }
    output.samples.push(sample)
  }
  console.log(JSON.stringify(output, null, 2))
} finally {
  await harness.close()
}
