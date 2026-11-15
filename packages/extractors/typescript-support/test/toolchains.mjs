// Opt-in qualification of the shipped Node helper against real published
// `typescript` releases and older Node.js runtimes. It downloads
// packages (and Node.js builds), so it is not part of `npm test`:
//
//   npm run test:toolchains --workspace @githubnext/projections-typescript-support
//
// PROJECTIONS_TOOLCHAIN_NODES selects Node.js versions (default 20.19.5,22.21.1); Node.js 18 is checked
// to fail explicitly.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {runHelper} from './support.mjs'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
// Downloads are cached with other tool caches, outside linted and checked sources.
const cache = path.join(packageRoot, '../../../node_modules/.cache/projections-toolchains')
const scratch = path.join(packageRoot, 'test/fixtures/.toolchains')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const typescripts = ['5.0.4', '5.4.5', '5.9.3', '6.0.3']
const nodes = (process.env.PROJECTIONS_TOOLCHAIN_NODES ?? '20.19.5,22.21.1').split(',').filter(Boolean)

/** Extracts one published package (without its dependencies or install scripts) into a checkout. */
async function install(checkout, name, version, as = name) {
  const archives = path.join(cache, 'packages')
  await mkdir(archives, {recursive: true})
  const file = path.join(archives, `${name.replace('/', '__')}-${version}.tgz`)
  if (!existsSync(file)) {
    const [packed] = JSON.parse(
      execFileSync(npm, ['pack', '--json', '--silent', '--pack-destination', archives, `${name}@${version}`], {encoding: 'utf8'}),
    )
    await writeFile(file, await readFile(path.join(archives, packed.filename)))
  }
  const target = path.join(checkout, 'node_modules', ...as.split('/'))
  await mkdir(target, {recursive: true})
  execFileSync('tar', ['-xzf', file, '-C', target, '--strip-components=1'])
}

/** A Node.js build for this platform, downloaded once. */
async function node(version) {
  const platform = {darwin: 'darwin', linux: 'linux'}[process.platform]
  if (!platform) throw new Error(`Node.js downloads are not supported on ${process.platform}`)
  const name = `node-v${version}-${platform}-${process.arch}`
  const directory = path.join(cache, 'node')
  const executable = path.join(directory, name, 'bin/node')
  if (!existsSync(executable)) {
    await mkdir(directory, {recursive: true})
    const archive = path.join(directory, `${name}.tar.gz`)
    execFileSync('curl', ['-fsSL', '-o', archive, `https://nodejs.org/dist/v${version}/${name}.tar.gz`])
    execFileSync('tar', ['-xzf', archive, '-C', directory])
  }
  return executable
}

const request = (extractor, root, inputs = {}) => ({
  protocolVersion: 0,
  projection: {id: 'matrix', definition: {id: 'matrix', extractor, renderer: 'graph', inputs}},
  repository: {root, revision: {kind: 'working-tree', ref: 'WORKTREE', commit: 'fixture', dirty: false}},
  capabilities: {trusted: false, network: false},
})
const extract = async (extractor, root, checkout, inputs, executable) => {
  const result = await runHelper(extractor, request(extractor, root, inputs), checkout, executable ? {node: executable} : {})
  assert.equal(result.status, 0, `${extractor}: ${result.stderr}`)
  return JSON.parse(result.stdout)
}
const signatures = state => Object.fromEntries(state.entities.map(entity => [entity.id, entity.data?.signature]))

await rm(scratch, {recursive: true, force: true})
const results = []
try {
  const repository = path.join(scratch, 'repository')
  await mkdir(repository, {recursive: true})
  await writeFile(path.join(repository, 'package.json'), JSON.stringify({name: '@example/matrix', types: './index.ts'}))
  await writeFile(
    path.join(repository, 'index.ts'),
    [
      'export interface Box<T extends string = string> { readonly value: T; map<U>(fn: (value: T) => U): U }',
      'export function choose(input: string): string;',
      'export function choose(input: number): number;',
      'export function choose(input: unknown): unknown { return input }',
      'export class Service { constructor(private readonly name: string) {} run(count: number): Box { return {value: this.name, map: fn => fn(this.name)} } }',
    ].join('\n'),
  )

  let reference
  for (const version of [...typescripts, '7.0.2']) {
    const checkout = path.join(scratch, `typescript-${version}`)
    await install(checkout, 'typescript', version)
    if (version.startsWith('7.')) {
      const native = await runHelper('typescript-public-api', request('typescript-public-api', repository), checkout)
      assert.equal(native.status, 1)
      assert.match(native.stderr, /add @typescript\/typescript6/)
      // The API package re-exports `@typescript/old`, an npm alias of typescript@6.
      await install(checkout, '@typescript/typescript6', 'latest')
      await install(checkout, 'typescript', '6.0.3', '@typescript/old')
    }
    const state = await extract('typescript-public-api', repository, checkout)
    reference ??= signatures(state)
    assert.deepEqual(signatures(state), reference, `typescript ${version} public API`)
    results.push(`typescript ${version}${version.startsWith('7.') ? ' + @typescript/typescript6' : ''}: ${state.entities.length} entities`)
  }

  for (const version of nodes) {
    const executable = await node(version)
    const checkout = path.join(scratch, 'typescript-5.9.3')
    assert.deepEqual(signatures(await extract('typescript-public-api', repository, checkout, {}, executable)), reference)
    results.push(`node ${version}: the TypeScript helper succeeds`)
  }
  const unsupported = await runHelper(
    'typescript-public-api',
    request('typescript-public-api', repository),
    path.join(scratch, 'typescript-5.9.3'),
    {node: await node('18.20.8')},
  )
  assert.equal(unsupported.status, 1)
  assert.match(unsupported.stderr, /requires Node\.js 20 or newer/)
  results.push('node 18.20.8: rejected explicitly')
  console.log(results.join('\n'))
} finally {
  await rm(scratch, {recursive: true, force: true})
}
