// Runs the browser sandbox in Chromium and WebKit: a real Web Worker per run, with modules of the test's own.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {chromium, webkit} from 'playwright'

const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  if (path === '/') {
    response.writeHead(200, {'Content-Type': 'text/html'}).end('<!doctype html><title>Comparator runtime</title>')
    return
  }
  if (!/^\/(dist\/(?:[\w-]+\/)?[\w-]+\.js|test\/wasm\.mjs)$/.test(path)) {
    response.writeHead(404).end()
    return
  }
  try {
    const body = await readFile(new URL(`..${path}`, import.meta.url))
    response.writeHead(200, {'Content-Type': path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'}).end(body)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

try {
  for (const browserType of [chromium, webkit]) {
    const browser = await browserType.launch({headless: true})
    try {
      const page = await browser.newPage()
      await page.goto(`${origin}/`)
      const results = await page.evaluate(async () => {
        const {runModuleInWorkerForTests: runComparator} = await import('/dist/browser-testing.js')
        const {comparator, op, wasm, i32, i64} = await import('/test/wasm.mjs')
        const input = {protocolVersion: 0, before: {}, after: {}, baseline: {}, options: {}}
        const comparison = '{"protocolVersion":0,"changes":[],"steps":[]}'
        const outcome = async promise => {
          try {
            return {value: await promise}
          } catch (error) {
            return {name: error.name, code: error.code, message: error.message}
          }
        }
        let heartbeats = 0
        const interval = setInterval(() => heartbeats++, 10)
        const deadline = await outcome(
          runComparator(comparator(comparison, {body: [...op.loop, ...op.br(0), ...op.end]}), input, {deadlineMs: 300}),
        )
        clearInterval(interval)
        return {
          ok: await outcome(runComparator(comparator(comparison), input)),
          deadline,
          heartbeats,
          imports: await outcome(
            runComparator(
              wasm({
                types: [
                  [[i32], [i32]],
                  [[i32, i32], [i64]],
                ],
                imports: [{module: 'env', name: 'now', type: 0}],
                functions: [
                  {type: 0, body: op.i32Const(0)},
                  {type: 1, body: op.i64Const(0)},
                ],
                memories: [{min: 1}],
                exports: [
                  {name: 'memory', kind: 2, index: 0},
                  {name: 'projections_alloc', kind: 0, index: 1},
                  {name: 'projections_compare', kind: 0, index: 2},
                ],
              }),
              input,
            ),
          ),
          memory: await outcome(
            runComparator(
              comparator(comparison, {
                body: [...op.i32Const(64), ...op.memoryGrow, ...op.drop],
              }),
              input,
              {maxMemoryPages: 16},
            ),
          ),
          error: await outcome(runComparator(comparator('{"error":"nope"}'), input)),
        }
      })
      const name = browserType.name()
      assert.deepEqual(results.ok, {value: {protocolVersion: 0, changes: [], steps: []}}, name)
      assert.equal(results.deadline.code, 'deadline', name)
      assert.ok(results.heartbeats >= 5, `${name}: main thread stays responsive while the worker loops`)
      assert.equal(results.imports.code, 'forbidden-import', name)
      assert.equal(results.memory.code, 'memory-limit', name)
      assert.deepEqual(results.error, {name: 'ComparatorRuntimeError', code: 'comparator-error', message: 'comparator failed: nope'}, name)
      console.log(`${name}: worker run, deadline termination, import rejection, memory cap and error results pass`)
    } finally {
      await browser.close()
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve))
}
