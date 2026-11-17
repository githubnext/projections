import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {createWasmEngine} from '@githubnext/projections-engine/browser'
import {executionEnvironment, runBounded} from './process.mjs'

// First-party components get no privileges: the CLI runs the default comparator
// as the same comparator module browsers run, so both explain a change identically.

const executable = fileURLToPath(new URL(`../dist/projections${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
const workspace = fileURLToPath(new URL('../../extractors/workspace-dependencies/tests/fixtures/npm/', import.meta.url))
const git = (root, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {cwd: root, encoding: 'utf8'})
const commit = root => {
  git(root, 'add', '--all')
  git(root, 'commit', '-qm', 'fixture')
  return git(root, 'rev-parse', 'HEAD').trim()
}
const cli = (cwd, args) =>
  runBounded(executable, args, {label: 'Projections CLI', cwd, env: executionEnvironment(process.env), timeoutMs: 60_000})
const artifact = name => readFile(fileURLToPath(import.meta.resolve(`@githubnext/projections-engine/${name}`)))

test('the CLI and the browser engine produce identical default comparisons', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'projections-first-party-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  await cp(workspace, root, {recursive: true})
  await mkdir(path.join(root, '.projections'))
  const definitions = [
    {id: 'dependencies', extractor: 'workspace-dependencies', renderer: 'graph'},
    {id: 'map', extractor: 'repository-map', renderer: 'treemap'},
    {
      id: 'map-by-size',
      extractor: 'repository-map',
      renderer: 'treemap',
      comparator: {options: {order: {by: 'data.size', direction: 'ascending'}}},
    },
  ]
  for (const definition of definitions) {
    await writeFile(path.join(root, '.projections', `${definition.id}.json`), JSON.stringify(definition))
  }
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'First-party test')
  git(root, 'config', 'user.email', 'first-party@example.invalid')
  git(root, 'config', 'commit.gpgsign', 'false')
  const before = commit(root)
  await rm(path.join(root, 'tools'), {recursive: true})
  await mkdir(path.join(root, 'docs/guides'), {recursive: true})
  await writeFile(path.join(root, 'docs/guides/start.md'), '# Start\n')
  await writeFile(path.join(root, 'README.md'), '# Acme\n\nA workspace.\n')
  const after = commit(root)

  const browser = await createWasmEngine({module: await artifact('engine.wasm')}, {module: await artifact('default-comparator.wasm')})
  const defaultComparator = await browser.defaultComparator()
  for (const definition of definitions) {
    const document = JSON.parse((await cli(root, ['compare', `${before}..${after}`, '-p', definition.id, '--json'])).stdout)
    assert.ok(document.comparison.changes.length > 0, `${definition.id} found no changes`)
    const options = definition.comparator?.options ?? {}
    const comparison = await browser.compare(document.before.extraction, document.after.extraction, options)
    assert.equal(JSON.stringify(comparison), JSON.stringify(document.comparison), definition.id)
    assert.deepEqual(document.comparator, defaultComparator, `${definition.id} names the module browsers run`)
  }
})
