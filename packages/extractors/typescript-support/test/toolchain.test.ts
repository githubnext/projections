import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {cp, mkdir, rm, symlink, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {test, type TestContext} from 'node:test'
import {installToolchain, runHelper, toolchain} from './support.mjs'

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

/** A repository checkout with the given files and, optionally, installed packages. */
async function checkout(t: TestContext, files: Record<string, string>): Promise<string> {
  const root = path.join(fixtures, `.checkout-${randomUUID()}`)
  t.after(() => rm(root, {recursive: true, force: true}))
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), {recursive: true})
    await writeFile(path.join(root, file), text)
  }
  return root
}

function request(extractor: string, root: string, inputs: Record<string, unknown> = {}) {
  return {
    protocolVersion: 0,
    projection: {id: 'test', definition: {id: 'test', extractor, renderer: 'graph', inputs}},
    repository: {root, revision: {kind: 'working-tree', ref: 'WORKTREE', commit: 'fixture', dirty: false}},
    capabilities: {trusted: false, network: false},
  }
}

const source = {
  'package.json': JSON.stringify({name: '@example/app', types: './index.ts'}),
  'index.ts': 'export function greet(name: string): string { return name; }\n',
}

test("the helper requires the repository's own typescript and never falls back to a bundled compiler", async t => {
  const root = await checkout(t, source)
  const result = await runHelper('typescript-public-api', request('typescript-public-api', root), root)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /typescript-public-api uses the TypeScript 5\.x or 6\.x compiler API from the repository's own installation/)
  assert.match(result.stderr, /Run your package manager's install .* `npm install --save-dev typescript@6`/)
})

test('a repository with only the native TypeScript 7 compiler is told to add the TypeScript 6 API package', async t => {
  const root = await checkout(t, {
    ...source,
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    'node_modules/@typescript/native-preview/package.json': JSON.stringify({
      name: '@typescript/native-preview',
      version: '7.0.0-dev.20261101.1',
    }),
  })
  const result = await runHelper('typescript-public-api', request('typescript-public-api', root), root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /@typescript\/native-preview 7\.0\.0-dev\.20261101\.1 \(TypeScript 7's native compiler\)/)
  assert.match(result.stderr, /`pnpm add --save-dev --workspace-root @typescript\/typescript6`/)
})

test('the revision is read from the extraction root while the compiler comes from the checkout', async t => {
  // The CLI materializes revisions without ignored files such as node_modules.
  const revision = await checkout(t, source)
  const result = await runHelper('typescript-public-api', request('typescript-public-api', revision), await toolchain())
  assert.equal(result.status, 0, result.stderr)
  assert.ok(JSON.parse(result.stdout).entities.some((entity: {label: string}) => entity.label === 'greet'))
})

test('every field the definition schema allows is accepted, not only the ones the helper reads', async t => {
  const revision = await checkout(t, source)
  const input = request('typescript-public-api', revision)
  Object.assign(input.projection.definition, {
    title: 'Public API',
    description: 'The exported API',
    comparator: {options: {}},
    correspondence: {},
    execution: {timeoutMs: 60_000},
    presentation: {changesOnly: true},
  })
  const result = await runHelper('typescript-public-api', input, await toolchain())
  assert.equal(result.status, 0, result.stderr)
})

test('a tsconfig beside the definition includes sources elsewhere in the repository', async t => {
  const revision = await checkout(t, {
    'packages/api/package.json': JSON.stringify({name: '@example/api'}),
    'packages/api/src/index.ts': source['index.ts'],
    '.github/projections/api/tsconfig.json': JSON.stringify({
      compilerOptions: {strict: true, noEmit: true, types: []},
      include: ['../../../packages/api/src'],
    }),
  })
  const result = await runHelper(
    'typescript-public-api',
    request('typescript-public-api', revision, {
      tsconfig: '.github/projections/api/tsconfig.json',
      entrypoints: ['packages/api/src/index.ts'],
    }),
    await toolchain(),
  )
  assert.equal(result.status, 0, result.stderr)
  assert.ok(JSON.parse(result.stdout).entities.some((entity: {label: string}) => entity.label === 'greet'))
})

test('entry points limit the program to what they reach, leaving out tests whose dependencies are not installed', async t => {
  const revision = await checkout(t, {
    'package.json': JSON.stringify({name: '@example/app'}),
    'tsconfig.json': JSON.stringify({compilerOptions: {strict: true, noEmit: true, types: []}, include: ['src']}),
    'src/index.ts': source['index.ts'],
    'src/index.test.ts': "import {it} from '@effect/vitest'\nit('greets', () => {})\n",
  })
  const scoped = await runHelper(
    'typescript-public-api',
    request('typescript-public-api', revision, {tsconfig: 'tsconfig.json', entrypoints: ['src/index.ts']}),
    await toolchain(),
  )
  assert.equal(scoped.status, 0, scoped.stderr)
  const whole = await runHelper(
    'typescript-public-api',
    request('typescript-public-api', revision, {tsconfig: 'tsconfig.json'}),
    await toolchain(),
  )
  assert.equal(whole.status, 1)
  assert.match(whole.stderr, /src\/index\.test\.ts:1: TS2307/)
  assert.match(whole.stderr, /Some modules didn't resolve: install the repository's dependencies, or set `inputs\.entrypoints`/)
})

test('typescript resolves from the configured tsconfig directory, as the package that owns it would', async t => {
  const root = await checkout(t, {
    'packages/app/package.json': JSON.stringify({name: '@example/app'}),
    'packages/app/tsconfig.json': JSON.stringify({compilerOptions: {strict: true, noEmit: true}, files: ['index.ts']}),
    'packages/app/index.ts': source['index.ts'],
  })
  await installToolchain(path.join(root, 'packages/app'))
  const nested = await runHelper(
    'typescript-public-api',
    request('typescript-public-api', root, {tsconfig: 'packages/app/tsconfig.json', entrypoints: ['packages/app/index.ts']}),
    root,
  )
  assert.equal(nested.status, 0, nested.stderr)
  const unconfigured = await runHelper('typescript-public-api', request('typescript-public-api', root), root)
  assert.equal(unconfigured.status, 1)
  assert.match(unconfigured.stderr, /resolved from \. in the repository checkout/)
})

test('installations outside the checkout are rejected rather than used silently', async t => {
  const outside = await checkout(t, {})
  await installToolchain(outside)
  const root = await checkout(t, source)
  await mkdir(path.join(root, 'node_modules'))
  await symlink(path.join(outside, 'node_modules/typescript'), path.join(root, 'node_modules/typescript'))
  const result = await runHelper('typescript-public-api', request('typescript-public-api', root), root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /typescript package resolved outside the repository checkout/)
})

test('unsupported TypeScript versions fail with the supported range and the TypeScript 7 remedy', async t => {
  const root = await checkout(t, source)
  const install = async (version: string) => {
    await rm(path.join(root, 'node_modules'), {recursive: true, force: true})
    await mkdir(path.join(root, 'node_modules/typescript'), {recursive: true})
    await writeFile(
      path.join(root, 'node_modules/typescript/package.json'),
      JSON.stringify({name: 'typescript', version, main: 'missing.js'}),
    )
  }
  await install('4.9.5')
  const old = await runHelper('typescript-public-api', request('typescript-public-api', root), root)
  assert.equal(old.status, 1)
  assert.match(old.stderr, /requires TypeScript 5\.x or 6\.x; the repository has typescript 4\.9\.5/)
  await install('7.0.2')
  const native = await runHelper('typescript-public-api', request('typescript-public-api', root), root)
  assert.equal(native.status, 1)
  assert.match(native.stderr, /typescript 7\.0\.2 .* is the native compiler without that API; add @typescript\/typescript6/)
  // The TypeScript 6 API package published for TypeScript 7 projects is used alongside it.
  const api = path.join(root, 'node_modules/@typescript/typescript6')
  await mkdir(path.dirname(api), {recursive: true})
  await cp(path.join(await toolchain(), 'node_modules/typescript'), api, {recursive: true})
  await writeFile(
    path.join(api, 'package.json'),
    JSON.stringify({name: '@typescript/typescript6', version: '6.0.2', main: './lib/typescript.js'}),
  )
  const compatible = await runHelper('typescript-public-api', request('typescript-public-api', root), root)
  assert.equal(compatible.status, 0, compatible.stderr)
})

test('the helper requires Node.js 20 or newer and says so', async t => {
  const root = await checkout(t, source)
  // Report an older release to the helper, as Node.js 18 would.
  const preload = path.join(root, 'node18.mjs')
  await writeFile(
    preload,
    "Object.defineProperty(process, 'versions', {value: {...process.versions, node: '18.20.8'}}); Object.defineProperty(process, 'version', {value: 'v18.20.8'});\n",
  )
  const result = await runHelper('typescript-public-api', request('typescript-public-api', root), await toolchain(), {
    args: ['--import', pathToFileURL(preload).href],
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /requires Node\.js 20 or newer; `node` on PATH is v18\.20\.8/)
})

test('the helper rejects extractors that run natively and invalid invocations', async () => {
  const root = await toolchain()
  const native = await runHelper('code-statistics', request('code-statistics', root), root)
  assert.equal(native.status, 1)
  assert.match(native.stderr, /The Node extractor helper does not implement code-statistics/)
  const relative = await runHelper('typescript-public-api', request('typescript-public-api', root), 'relative/checkout')
  assert.equal(relative.status, 1)
  assert.match(relative.stderr, /Usage: extractor\.mjs <extractor> <absolute repository checkout>/)
})
