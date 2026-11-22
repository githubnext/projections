import assert from 'node:assert/strict'
import {mkdtemp, writeFile, rm, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {createNativeEngine, EngineTransportError} from '../dist/native.js'
import {createWasmEngine} from '../dist/browser.js'

const empty = {protocolVersion: 0, schema: 'graph/v0', entities: [], relationships: []}
test('native transport explicitly handles spawn, timeout, malformed output, nonzero exits and overflow', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projections-engine-transport-'))
  let index = 0
  const executable = async body => {
    const path = join(directory, `fake engine ${index++}`)
    await writeFile(path, `#!/usr/bin/env node\n${body}\n`, {mode: 0o755})
    return path
  }
  try {
    const cases = [
      {executable: join(directory, 'missing')},
      {executable: await executable('process.stdin.resume(); setTimeout(() => {}, 10000)'), timeoutMs: 20},
      {executable: await executable('process.stdout.write("not JSON")')},
      {executable: await executable('process.stdout.write(JSON.stringify({ok:true,result:{}})); process.exitCode=2')},
      {
        executable: await executable(
          'process.stdout.write(JSON.stringify({ok:false,diagnostics:[{severity:"error",code:"x",path:"",message:"bad"}]}))',
        ),
      },
      {executable: await executable('process.stdout.write(JSON.stringify({ok:false,diagnostics:[]})); process.exitCode=1')},
      {executable: await executable('process.stdout.write("x".repeat(2000))'), maxResponseBytes: 100},
      {executable: await executable('process.stderr.write("x".repeat(70000))')},
      {executable: await executable('process.kill(process.pid, "SIGTERM")')},
    ]
    for (const options of cases) {
      await assert.rejects(createNativeEngine(options).normalize(empty), EngineTransportError)
    }
    for (const options of [
      {timeoutMs: 0},
      {timeoutMs: Infinity},
      {timeoutMs: 300001},
      {maxResponseBytes: 0},
      {maxResponseBytes: 2 ** 30},
    ]) {
      assert.throws(() => createNativeEngine(options), RangeError)
    }
  } finally {
    await rm(directory, {recursive: true})
  }
})

test('Wasm module, byte view and failed module/URL loading are explicit', async () => {
  const bytes = await readFile(new URL('../artifacts/engine.wasm', import.meta.url))
  const comparator = {module: await readFile(new URL('../artifacts/default-comparator.wasm', import.meta.url))}
  const module = await WebAssembly.compile(bytes)
  assert.deepEqual(await (await createWasmEngine({module}, comparator)).normalize(empty), empty)
  await assert.rejects(createWasmEngine({module: new Uint8Array([0, 1, 2])}, comparator), WebAssembly.CompileError)
  const noExports = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
  await assert.rejects(createWasmEngine({module: noExports}, comparator), EngineTransportError)
  await assert.rejects(createWasmEngine({url: 'data:application/wasm;base64,AAECAw=='}, comparator), WebAssembly.CompileError)
})

test('comparator modules must have zero imports, the ABI exports and well-formed output', async () => {
  const engine = {module: await readFile(new URL('../artifacts/engine.wasm', import.meta.url))}
  // (module (import "env" "clock" (func)))
  const importing = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 13, 1, 3, 101, 110, 118, 5, 99, 108, 111, 99, 107, 0, 0,
  ])
  assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(importing)).length, 1)
  await assert.rejects(createWasmEngine(engine, {module: importing}), /zero imports/)
  const noExports = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
  const wasm = await createWasmEngine(engine, {module: noExports})
  await assert.rejects(
    wasm.compare(empty, empty),
    error => error instanceof EngineTransportError && /comparator module ABI/.test(error.message),
  )
  await assert.rejects(createNativeEngine({comparator: {module: importing}}).compare(empty, empty), /zero imports/)
})

test('browser entries and package root never import native APIs', async () => {
  for (const name of ['index', 'browser', 'wasm-transport', 'comparator-transport', 'transport', 'worker', 'worker-entry']) {
    const source = await readFile(new URL(`../dist/${name}.js`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /(?:node:|\.\/native\.js)/)
  }
})

test('public entrypoints and Wasm exports use the primary Engine names', async () => {
  const shared = ['EngineError', 'EngineTransportError', 'limits']
  for (const [entry, factory] of [
    ['index', undefined],
    ['native', 'createNativeEngine'],
    ['browser', 'createWasmEngine'],
    ['worker', 'createWorkerEngine'],
  ]) {
    const exports = await import(`../dist/${entry}.js`)
    assert.deepEqual(Object.keys(exports).toSorted(), [...shared, ...(factory ? [factory] : [])].toSorted())
  }
  const bytes = await readFile(new URL('../artifacts/engine.wasm', import.meta.url))
  const module = await WebAssembly.compile(bytes)
  const functions = WebAssembly.Module.exports(module)
    .filter(entry => entry.kind === 'function')
    .map(entry => entry.name)
    .toSorted()
  assert.deepEqual(functions, ['engine_alloc', 'engine_call', 'engine_free'])
  const comparator = await WebAssembly.compile(await readFile(new URL('../artifacts/default-comparator.wasm', import.meta.url)))
  assert.deepEqual(WebAssembly.Module.imports(comparator), [], 'the default comparator module has zero imports')
  assert.deepEqual(
    WebAssembly.Module.exports(comparator)
      .map(entry => `${entry.kind}:${entry.name}`)
      .toSorted(),
    ['function:projections_alloc', 'function:projections_compare', 'memory:memory'],
  )
})

test('the JavaScript SHA-256 for contexts without Web Crypto matches it at every padding boundary', async () => {
  const {createHash} = await import('node:crypto')
  const {sha256Bytes} = await import('../dist/transport.js')
  for (const length of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000, 100_000]) {
    const bytes = Uint8Array.from({length}, (_, index) => (index * 31 + length) & 0xff)
    assert.equal(Buffer.from(sha256Bytes(bytes)).toString('hex'), createHash('sha256').update(bytes).digest('hex'), `${length} bytes`)
  }
})
