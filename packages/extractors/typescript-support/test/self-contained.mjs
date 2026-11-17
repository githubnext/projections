// Verifies the built helper as the native CLI ships it: one file, copied alone
// into an isolated directory, that imports only Node.js built-ins and runs against
// a repository checkout holding the project's own `typescript`.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {builtinModules} from 'node:module'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {installToolchain} from './support.mjs'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const root = path.join(packageRoot, `.runtime-self-contained-${randomUUID()}`)
const built = path.join(packageRoot, 'dist/extractor.mjs')

try {
  const text = await readFile(built, 'utf8')
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))
  const specifiers = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)].map(match => match[1])
  assert.ok(specifiers.length > 0)
  assert.deepEqual(
    specifiers.filter(specifier => !builtins.has(specifier)),
    [],
    'The helper imports only Node.js built-ins',
  )
  assert.doesNotMatch(text, /@githubnext\/projections-/, 'No Projections npm packages are referenced')

  const helper = path.join(root, 'helper/extractor.mjs')
  await mkdir(path.dirname(helper), {recursive: true})
  await cp(built, helper)
  const repository = path.join(root, 'repository')
  await mkdir(repository, {recursive: true})
  await writeFile(path.join(repository, 'package.json'), JSON.stringify({name: '@example/app', types: './index.ts'}))
  await writeFile(path.join(repository, 'index.ts'), 'export function nativeExport(value: string): string { return value }\n')
  const bare = path.join(root, 'bare-checkout')
  await mkdir(bare)
  const checkout = await installToolchain(path.join(root, 'checkout'))

  // Fail any module resolution that leaves this directory, so an ancestor workspace's
  // node_modules can never satisfy the helper by accident.
  const isolation = path.join(root, 'isolation.mjs')
  await writeFile(
    isolation,
    `
import {registerHooks} from 'node:module'
import {fileURLToPath} from 'node:url'
const allowed = ${JSON.stringify(root + path.sep)}
registerHooks({resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context)
  if (result.url.startsWith('file:') && !fileURLToPath(result.url).startsWith(allowed)) {
    throw Object.assign(new Error('Resolved outside the isolated helper: ' + specifier), {code: 'ERR_MODULE_NOT_FOUND'})
  }
  return result
}})
`,
  )
  const collect = (id, inputs = {}, toolchain = checkout) =>
    spawnSync(process.execPath, ['--import', pathToFileURL(isolation).href, helper, id, toolchain], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      input: JSON.stringify({
        protocolVersion: 0,
        projection: {id, definition: {id, extractor: id, renderer: 'graph', inputs}},
        repository: {root: repository, revision: {kind: 'working-tree', ref: 'HEAD', commit: 'fixture', dirty: false}},
        capabilities: {trusted: false, network: false},
      }),
    })

  const typed = collect('typescript-public-api')
  assert.equal(typed.status, 0, typed.stderr)
  assert.ok(JSON.parse(typed.stdout).entities.some(entity => entity.label === 'nativeExport'))
  const untyped = collect('typescript-public-api', {}, bare)
  assert.equal(untyped.status, 1)
  assert.equal(untyped.stdout, '')
  assert.match(untyped.stderr, /No `typescript` package is installed there/)

  const native = collect('code-statistics')
  assert.equal(native.status, 1)
  assert.match(native.stderr, /The Node extractor helper does not implement code-statistics/)
  console.log(
    `Self-contained helper verified: ${(text.length / 1024).toFixed(0)} KiB, Node.js built-ins only (${[...new Set(specifiers)].join(', ')})`,
  )
} finally {
  await rm(root, {recursive: true, force: true})
}
