import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {chromium, webkit} from 'playwright'

export async function browserHarness(engine = 'chromium') {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    const files = {
      '/': ['text/html', null],
      '/dist/browser.js': ['text/javascript', '../dist/browser.js'],
      '/dist/engine.js': ['text/javascript', '../dist/engine.js'],
      '/dist/encoding.js': ['text/javascript', '../dist/encoding.js'],
      '/dist/decoding.js': ['text/javascript', '../dist/decoding.js'],
      '/dist/transport.js': ['text/javascript', '../dist/transport.js'],
      '/dist/wasm-transport.js': ['text/javascript', '../dist/wasm-transport.js'],
      '/dist/comparator-transport.js': ['text/javascript', '../dist/comparator-transport.js'],
      '/dist/worker.js': ['text/javascript', '../dist/worker.js'],
      '/dist/worker-entry.js': ['text/javascript', '../dist/worker-entry.js'],
      '/artifacts/engine.wasm': ['application/wasm', '../artifacts/engine.wasm'],
      '/artifacts/default-comparator.wasm': ['application/wasm', '../artifacts/default-comparator.wasm'],
    }
    if (!Object.hasOwn(files, path)) {
      response.writeHead(404).end()
      return
    }
    const [type, file] = files[path]
    try {
      const body = file ? await readFile(new URL(file, import.meta.url)) : '<!doctype html><title>Engine conformance</title>'
      response.writeHead(200, {'Content-Type': type}).end(body)
    } catch (error) {
      response.writeHead(500).end(String(error))
    }
  })
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  let browser
  try {
    browser = await (engine === 'webkit' ? webkit : chromium).launch({headless: true})
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    const startupMs = await page.evaluate(async () => {
      const start = performance.now()
      const {createWasmEngine} = await import('/dist/browser.js')
      globalThis.engine = await createWasmEngine()
      return performance.now() - start
    })
    return {
      page,
      browser,
      startupMs,
      async close() {
        await browser.close()
        await new Promise(resolve => {
          server.close(resolve)
        })
      },
    }
  } catch (error) {
    await browser?.close()
    await new Promise(resolve => {
      server.close(resolve)
    })
    throw error
  }
}

export function graph(count = 1000, relationshipCount = 5000) {
  return {
    protocolVersion: 0,
    schema: 'graph/v0',
    entities: Array.from({length: count}, (_, i) => ({
      id: `node:${String(i).padStart(5, '0')}`,
      kind: 'service',
      label: `Service ${i}`,
      data: {size: i / 10, language: 'TypeScript'},
      evidence: [{kind: 'source', source: `src/service-${i}.ts`}],
    })),
    relationships: Array.from({length: relationshipCount}, (_, i) => ({
      id: `edge:${String(i).padStart(5, '0')}`,
      kind: 'uses',
      from: `node:${String(i % count).padStart(5, '0')}`,
      to: `node:${String((i * 13 + 1) % count).padStart(5, '0')}`,
    })),
  }
}
