// `check --fast`, `build` and `test --filter`: the cheap steps before a full check, and when a dependency needs rebuilding.
import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, utimesSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import type {Affected} from '../src/lib/affected.ts'
import {gates, type GateContext} from '../src/lib/gates.ts'
import type {Unit} from '../src/lib/packages.ts'
import {staleness} from '../src/commands/work/build.ts'
import {testPlan} from '../src/commands/work/test.ts'

const unit = (path: string, overrides: Partial<Unit> = {}): Unit => ({
  path,
  kinds: ['npm'],
  readme: undefined,
  names: [`@fixture/${path.replace('/', '-')}`],
  description: undefined,
  source: 'missing',
  dependsOn: [],
  scripts: ['build', 'typecheck'],
  ...overrides,
})

const affected = (changed: string[], dependants: string[], kinds: Affected['kinds']): Affected => ({
  changed,
  dependants,
  unowned: [],
  regenerate: [],
  kinds,
})

/** A workspace with a src and a dist file, modified at the given times (seconds). */
function workspace(root: string, path: string, times: {src: number; dist?: number}) {
  mkdirSync(join(root, path, 'src'), {recursive: true})
  writeFileSync(join(root, path, 'src/index.ts'), '')
  utimesSync(join(root, path, 'src/index.ts'), times.src, times.src)
  if (times.dist === undefined) return
  mkdirSync(join(root, path, 'dist'), {recursive: true})
  writeFileSync(join(root, path, 'dist/index.js'), '')
  utimesSync(join(root, path, 'dist/index.js'), times.dist, times.dist)
}

const plan = (name: string, context: GateContext) => (gates.find(gate => gate.name === name) as (typeof gates)[number]).plan(context)
const argvs = (planned: ReturnType<typeof plan>) =>
  'commands' in planned ? planned.commands.map(command => command.argv.join(' ')) : planned

test('--fast leaves out every gate that builds, tests or reads the whole tree', () => {
  assert.deepEqual(
    gates.filter(gate => !gate.fast).map(gate => gate.name),
    ['tsdoc', 'build', 'notices', 'comparators', 'docs', 'clippy'],
  )
})

test('cargo check covers the changed crates with --fast, and their dependants with --affected', () => {
  const units = [
    unit('core', {kinds: ['crate'], names: ['core'], scripts: []}),
    unit('app', {kinds: ['crate'], names: ['app'], dependsOn: ['core']}),
  ]
  const change = affected(['core'], ['app'], ['rust'])
  assert.deepEqual(argvs(plan('cargo-check', {root: '.', units, affected: change, fast: true})), [
    'cargo check -p core --all-targets --locked --message-format short',
  ])
  assert.deepEqual(argvs(plan('cargo-check', {root: '.', units, affected: change})), [
    'cargo check -p core -p app --all-targets --locked --message-format short',
  ])
  assert.deepEqual(plan('cargo-check', {root: '.', units, affected: affected(['docs'], [], ['docs']), fast: true}), {
    skip: 'no Rust changed',
  })
})

test('--fast typechecks only the changed workspaces, once their dependencies are built and current', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-fast-'))
  const units = [unit('lib'), unit('app', {dependsOn: ['lib']}), unit('other', {dependsOn: ['lib']})]
  workspace(root, 'lib', {src: 100, dist: 200})
  const context = {root, units, affected: affected(['app'], [], ['ts']), fast: true}
  assert.deepEqual(argvs(plan('typecheck', context)), ['npm run typecheck --workspace @fixture/app'])
  workspace(root, 'lib', {src: 300, dist: 200})
  assert.match((plan('typecheck', context) as {skip: string}).skip, /app \(lib unbuilt or older than its src\)/)
  // One that can be checked still is; the other waits, noted.
  const both = plan('typecheck', {...context, affected: affected(['app', 'lib'], ['other'], ['ts'])})
  assert.deepEqual(argvs(both), ['npm run typecheck --workspace @fixture/lib'])
  assert.match((both as {note: string}).note, /app/)
})

test('build: a dependency is current until its src, or a dependency of its own, is newer than its dist', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-build-'))
  const units = [unit('lib'), unit('app', {dependsOn: ['lib']}), unit('core', {kinds: ['crate'], scripts: []})]
  workspace(root, 'lib', {src: 100, dist: 200})
  workspace(root, 'app', {src: 100, dist: 300})
  const [lib, app] = units as [Unit, Unit]
  assert.equal(staleness(root, units, app, new Set()), undefined)
  assert.equal(staleness(root, units, app, new Set(['lib'])), 'lib was rebuilt')
  workspace(root, 'lib', {src: 100, dist: 400})
  assert.equal(staleness(root, units, app, new Set()), 'lib was built after it')
  workspace(root, 'lib', {src: 500, dist: 400})
  assert.equal(staleness(root, units, lib, new Set()), 'src is newer than dist')
  workspace(root, 'new', {src: 100})
  assert.equal(staleness(root, units, unit('new'), new Set()), 'not built')
  assert.equal(staleness(root, units, unit('wasm', {dependsOn: ['core']}), new Set()), 'builds Rust, which Cargo keeps current')
})

test('test --filter narrows each runner to the matching tests, and needs a target', () => {
  const fixture = fileURLToPath(new URL('fixtures/repo/', import.meta.url))
  const commands = (options: Parameters<typeof testPlan>[1]) => testPlan(fixture, options).runs.map(run => run.command.argv.join(' '))
  assert.deepEqual(commands({target: 'app', rust: true, filter: 'parses'}), [
    'npm test --workspace @fixture/app -- --test-name-pattern=parses',
    'cargo test --locked -p fixture-app parses',
  ])
  assert.throws(() => testPlan(fixture, {filter: 'parses'}), /needs a target/)
})
