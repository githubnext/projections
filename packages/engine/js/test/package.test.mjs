import assert from 'node:assert/strict'
import {mkdtemp, writeFile, rm, lstat, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'

test('packed protocol+engine install and execute without workspace links or Rust toolchain', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projections-engine-package-'))
  // The npm running this test, as node and its script: npm is a .cmd shim on Windows, which can't run without a shell.
  const npm = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ['npm']
  const run = (args, cwd = directory) =>
    execFileSync(npm[0], [...npm.slice(1), ...args], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})
  try {
    const pack = relative => {
      const cwd = fileURLToPath(new URL(relative, import.meta.url))
      const output = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', directory], cwd))
      return join(directory, output[0].filename)
    }
    const protocol = pack('../../../schemas/')
    const engine = pack('../')
    await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}')
    run(['install', '--ignore-scripts', '--no-audit', '--no-fund', protocol, engine])
    const installed = join(directory, 'node_modules/@githubnext/projections-engine')
    assert.equal((await lstat(installed)).isSymbolicLink(), false)
    const notices = await readFile(join(installed, 'artifacts/THIRD_PARTY_NOTICES.txt'), 'utf8')
    assert.match(notices, /serde_jcs 0\.2\.0/u)
    assert.match(notices, /ryu-js 0\.2\.2/u)
    assert.match(notices, /LICENSE-APACHE/u)
    await writeFile(
      join(directory, 'verify.mjs'),
      `
      import assert from 'node:assert/strict'
      import {readFile} from 'node:fs/promises'
      import {createNativeEngine} from '@githubnext/projections-engine/native'
      import {createWasmEngine} from '@githubnext/projections-engine/browser'
      import {EngineError} from '@githubnext/projections-engine'
      const state = {protocolVersion:0,schema:'graph/v0',entities:[],relationships:[]}
      const after = {...state,entities:[{id:'a',kind:'service',label:'A'}]}
      const native = createNativeEngine()
      const browser = await createWasmEngine(
        {module:await readFile(new URL(import.meta.resolve('@githubnext/projections-engine/engine.wasm')))},
        {module:await readFile(new URL(import.meta.resolve('@githubnext/projections-engine/default-comparator.wasm')))})
      assert.deepEqual(await native.canonicalize(state), await browser.canonicalize(state))
      assert.deepEqual(await native.compare(state, after), await browser.compare(state, after))
      assert.equal((await native.compare(state, after)).changes[0].status, 'added')
      await assert.rejects(native.decode('{"a":1,"a":2}'), EngineError)
      await assert.rejects(native.parseJson('{"format":"one","format":"two"}'), EngineError)
      assert.deepEqual(await browser.parseJson('{"format":"projections.extraction"}'), {format:'projections.extraction'})
      assert.equal(typeof (await import('@githubnext/projections-engine/worker')).createWorkerEngine, 'function')
      const {loadArtifact} = await import('@githubnext/projections-engine/artifacts')
      await assert.rejects(loadArtifact('{"format":"projections.extraction"}', {engine: native}))
    `,
    )
    execFileSync(process.execPath, ['verify.mjs'], {cwd: directory, stdio: 'pipe', env: {...process.env, PATH: directory}})
    await writeFile(
      join(directory, 'verify.ts'),
      `
      import {createNativeEngine} from '@githubnext/projections-engine/native'
      import {createWasmEngine} from '@githubnext/projections-engine/browser'
      import {createWorkerEngine} from '@githubnext/projections-engine/worker'
      import type {Comparison, ProjectionEngine, Json} from '@githubnext/projections-engine'
      const native: ProjectionEngine = createNativeEngine({timeoutMs: 1000})
      const parsed: Promise<Json> = native.parseJson('{}')
      const compared: Promise<Comparison> = native.compare({}, {}, {order: {by: 'dependents'}})
      createWasmEngine().then((engine: ProjectionEngine) => engine.decode('{}'))
      createWorkerEngine().then(engine => { const semantic: ProjectionEngine = engine; engine.dispose() })
    `,
    )
    const tsc = fileURLToPath(new URL('../../../../node_modules/typescript/bin/tsc', import.meta.url))
    execFileSync(process.execPath, [tsc, '--strict', '--module', 'NodeNext', '--target', 'ES2022', '--noEmit', 'verify.ts'], {
      cwd: directory,
      stdio: 'pipe',
    })
  } finally {
    await rm(directory, {recursive: true})
  }
})
