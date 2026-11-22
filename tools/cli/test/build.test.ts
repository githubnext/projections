// `check --fast`, `build` and `test --filter`: the cheap steps before a full check, and when a dependency needs rebuilding.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import type {Affected} from '../src/lib/affected.ts'
import {buildInputs, buildState, inputSignature, recordBuild} from '../src/lib/builds.ts'
import {gates, type GateContext} from '../src/lib/gates.ts'
import type {Unit} from '../src/lib/packages.ts'
import {recordSuccess, restoreIfUnchanged, snapshot, staleness} from '../src/commands/work/build.ts'
import {nodeTestPattern, testPlan} from '../src/commands/work/test.ts'

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

/** A workspace with a src and a dist file, files and directories modified at the given times (seconds). */
function workspace(root: string, path: string, times: {src: number; dist?: number}) {
  mkdirSync(join(root, path, 'src'), {recursive: true})
  writeFileSync(join(root, path, 'src/index.ts'), '')
  utimesSync(join(root, path, 'src/index.ts'), times.src, times.src)
  utimesSync(join(root, path, 'src'), times.src, times.src)
  if (times.dist === undefined) return
  mkdirSync(join(root, path, 'dist'), {recursive: true})
  writeFileSync(join(root, path, 'dist/index.js'), '')
  utimesSync(join(root, path, 'dist/index.js'), times.dist, times.dist)
  utimesSync(join(root, path, 'dist'), times.dist, times.dist)
}

const plan = (name: string, context: GateContext) => gates.find(gate => gate.name === name)!.plan(context)
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
  // The workspace's own manifest, lockfile or toolchain affect every crate, alone or beside a crate's change.
  for (const changed of [[], ['core']]) {
    assert.deepEqual(
      argvs(plan('cargo-check', {root: '.', units, affected: affected(changed, [], ['rust']), files: ['Cargo.lock'], fast: true})),
      ['cargo check --workspace --all-targets --locked --message-format short'],
    )
  }
})

test('--fast typechecks only the changed workspaces, once their dependencies are built and current', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-fast-'))
  const units = [unit('lib'), unit('app', {dependsOn: ['lib']}), unit('other', {dependsOn: ['lib']})]
  workspace(root, 'lib', {src: 100, dist: 200})
  const context = {root, units, affected: affected(['app'], [], ['ts']), fast: true}
  assert.deepEqual(argvs(plan('typecheck', context)), ['npm run typecheck --workspace @fixture/app'])
  workspace(root, 'lib', {src: 300, dist: 200})
  assert.match((plan('typecheck', context) as {skip: string}).skip, /app \(lib unbuilt, unfinished or out of date\)/u)
  // One that can be checked still is; the other waits, noted.
  const both = plan('typecheck', {...context, affected: affected(['app', 'lib'], ['other'], ['ts'])})
  assert.deepEqual(argvs(both), ['npm run typecheck --workspace @fixture/lib'])
  assert.match((both as {note: string}).note, /app/u)
})

test('--fast waits for transitive dependencies too, and for one built after a dependency of its own', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-fast-deep-'))
  const units = [unit('base'), unit('lib', {dependsOn: ['base']}), unit('app', {dependsOn: ['lib']})]
  workspace(root, 'base', {src: 100, dist: 200})
  workspace(root, 'lib', {src: 100, dist: 300})
  const context = {root, units, affected: affected(['app'], [], ['ts']), fast: true}
  assert.deepEqual(argvs(plan('typecheck', context)), ['npm run typecheck --workspace @fixture/app'])
  // base rebuilt after lib: lib's declarations may describe the old base.
  workspace(root, 'base', {src: 100, dist: 400})
  assert.match((plan('typecheck', context) as {skip: string}).skip, /app \(lib unbuilt, unfinished or out of date\)/u)
  workspace(root, 'lib', {src: 100, dist: 500})
  workspace(root, 'base', {src: 600, dist: 400})
  assert.match((plan('typecheck', context) as {skip: string}).skip, /app \(base unbuilt, unfinished or out of date\)/u)
})

test('lint: a process per workspace; --fast lints changed TypeScript once its dependencies are current, and JavaScript always', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-lint-'))
  const units = [unit('lib'), unit('app', {dependsOn: ['lib']}), unit('other')]
  workspace(root, 'lib', {src: 100, dist: 200})
  const files = ['app/src/a.ts', 'app/scripts/b.mjs', 'other/src/c.ts', 'tools/d.mjs']
  for (const file of files) {
    mkdirSync(join(root, file, '..'), {recursive: true})
    writeFileSync(join(root, file), '')
  }
  const eslint = (...paths: string[]) => `npx --no-install eslint --quiet --no-warn-ignored ${paths.join(' ')}`
  const fast = {root, units, affected: affected(['app', 'other'], [], ['ts']), files, fast: true}
  assert.deepEqual(argvs(plan('lint', fast)), [
    eslint('tools/d.mjs'),
    eslint('app/src/a.ts', 'app/scripts/b.mjs'),
    eslint('other/src/c.ts'),
  ])
  workspace(root, 'lib', {src: 300, dist: 200})
  const waiting = plan('lint', fast)
  assert.deepEqual(argvs(waiting), [eslint('tools/d.mjs'), eslint('app/scripts/b.mjs'), eslint('other/src/c.ts')])
  assert.match((waiting as {note: string}).note, /app \(lib/u)
  // --affected lints whole workspaces, dependants included; the lint configuration, or everything, is npm run lint.
  const affectedOnly = {root, units, affected: affected(['lib'], ['app'], ['ts']), files: ['lib/src/index.ts']}
  assert.deepEqual(argvs(plan('lint', affectedOnly)), [eslint('lib'), eslint('app')])
  assert.deepEqual(argvs(plan('lint', {...affectedOnly, files: ['eslint.config.js']})), ['npm run --silent lint'])
  assert.deepEqual(argvs(plan('lint', {root, units})), ['npm run --silent lint'])
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

test('build: a deleted source file, or a build that did not finish, makes a workspace stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-stale-'))
  const lib = unit('lib')
  workspace(root, 'lib', {src: 100, dist: 200})
  writeFileSync(join(root, 'lib/src/extra.ts'), '')
  utimesSync(join(root, 'lib/src/extra.ts'), 100, 100)
  utimesSync(join(root, 'lib/src'), 100, 100)
  assert.equal(buildState(root, lib), 'current')
  unlinkSync(join(root, 'lib/src/extra.ts'))
  assert.equal(buildState(root, lib), 'stale')
  workspace(root, 'lib', {src: 100, dist: 200})
  // A failed build can leave outputs newer than their src; only a successful one clears this.
  recordBuild(root, 'lib', {building: true})
  assert.equal(staleness(root, [lib], lib, new Set()), 'its last build did not finish')
  recordBuild(root, 'lib', {})
  assert.equal(staleness(root, [lib], lib, new Set()), undefined)
})

test('build: a workspace checked unchanged after its dependency rebuilt stays current against it', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-checked-'))
  const units = [unit('lib'), unit('app', {dependsOn: ['lib']})]
  workspace(root, 'lib', {src: 100, dist: 400})
  workspace(root, 'app', {src: 100, dist: 300})
  assert.equal(staleness(root, units, units[1]!, new Set()), 'lib was built after it')
  recordBuild(root, 'app', {checked: 500_000})
  assert.equal(staleness(root, units, units[1]!, new Set()), undefined)
})

test('build: outputs written again unchanged keep their times, so nothing above them rebuilds', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-unchanged-'))
  const lib = unit('lib')
  workspace(root, 'lib', {src: 100, dist: 200})
  const before = snapshot(root, lib)
  workspace(root, 'lib', {src: 100, dist: 900})
  assert.equal(restoreIfUnchanged(before, snapshot(root, lib)), true)
  assert.equal(statSync(join(root, 'lib/dist/index.js')).mtimeMs, 200_000)
  // A build that empties and refills its output directories gets their times back too (Cargo watches directories).
  const emptied = snapshot(root, lib)
  rmSync(join(root, 'lib/dist'), {recursive: true})
  mkdirSync(join(root, 'lib/dist'))
  writeFileSync(join(root, 'lib/dist/index.js'), '')
  assert.equal(restoreIfUnchanged(emptied, snapshot(root, lib)), true)
  assert.equal(statSync(join(root, 'lib/dist')).mtimeMs, 200_000)
  // Its src, rewritten, is newer than those kept times; the recorded check says it is current all the same.
  workspace(root, 'lib', {src: 500, dist: 200})
  assert.equal(buildState(root, lib), 'stale')
  recordBuild(root, 'lib', {checked: 600_000})
  assert.equal(buildState(root, lib), 'current')
  writeFileSync(join(root, 'lib/dist/index.js'), 'changed')
  assert.equal(restoreIfUnchanged(before, snapshot(root, lib)), false)
})

/**
 * A workspace as `workspace` makes it, with the build inputs beside its src: a manifest whose build runs a script, a
 * tsconfig extending the root's and a script outside its scripts directory that the build names.
 */
function configured(root: string, path: string, times: {src: number; dist?: number}) {
  workspace(root, path, times)
  const build = 'tsc -p tsconfig.json && node scripts/css.mjs && node build/assets.mjs'
  writeFileSync(join(root, path, 'package.json'), JSON.stringify({scripts: {build}}))
  writeFileSync(join(root, path, 'tsconfig.json'), '{"extends": "../tsconfig.base.json"}')
  writeFileSync(join(root, 'tsconfig.base.json'), '{}')
  mkdirSync(join(root, path, 'scripts'), {recursive: true})
  writeFileSync(join(root, path, 'scripts/css.mjs'), '')
  mkdirSync(join(root, path, 'build'), {recursive: true})
  writeFileSync(join(root, path, 'build/assets.mjs'), '')
  for (const file of ['package.json', 'tsconfig.json', 'scripts/css.mjs', 'build/assets.mjs']) {
    utimesSync(join(root, path, file), times.src, times.src)
  }
  utimesSync(join(root, 'tsconfig.base.json'), times.src, times.src)
}

/** A successful `tools build` of `unit`: its inputs' signature first, then the outputs `write` leaves. */
function built(root: string, target: Unit, write: () => void, started = Date.now()): boolean {
  const inputs = inputSignature(root, buildInputs(root, target))
  const before = snapshot(root, target)
  write()
  return recordSuccess(root, target, inputs, before, started)
}

test('build: an edit to a build script or configuration outside src makes a built workspace stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-inputs-'))
  const units = [unit('lib'), unit('app', {dependsOn: ['lib']})]
  const [lib, app] = units as [Unit, Unit]
  configured(root, 'lib', {src: 100, dist: 200})
  workspace(root, 'app', {src: 100, dist: 300})
  assert.deepEqual(buildInputs(root, lib), [
    'lib/build/assets.mjs',
    'lib/package.json',
    'lib/scripts/css.mjs',
    'lib/tsconfig.json',
    'tsconfig.base.json',
  ])
  // Built outside `tools build`, it has only times to go by: a script newer than its dist makes it stale.
  assert.equal(buildState(root, lib), 'current')
  utimesSync(join(root, 'lib/scripts/css.mjs'), 250, 250)
  assert.equal(staleness(root, units, lib, new Set()), 'lib/scripts/css.mjs is newer than dist')
  built(root, lib, () => writeFileSync(join(root, 'lib/dist/index.js'), 'built'))
  utimesSync(join(root, 'lib/dist/index.js'), 200, 200)
  // Recorded, its inputs' content decides, not their times; untouched, it and what depends on it stay current.
  assert.equal(buildState(root, lib), 'current')
  assert.equal(staleness(root, units, app, new Set()), undefined)
  for (const input of ['lib/scripts/css.mjs', 'lib/build/assets.mjs', 'lib/tsconfig.json', 'tsconfig.base.json', 'lib/package.json']) {
    const path = join(root, input)
    const content = readFileSync(path)
    writeFileSync(path, `${content.toString()} `)
    assert.equal(staleness(root, units, lib, new Set()), 'its build inputs changed since its last build', input)
    writeFileSync(path, content)
    assert.equal(buildState(root, lib), 'current', input)
  }
  // A new configuration file counts too.
  writeFileSync(join(root, 'lib/vite.config.ts'), '')
  assert.equal(buildState(root, lib), 'stale')
  // Rebuilt since by `npm run build`, which records nothing, its outputs are newer than that record: times decide.
  utimesSync(join(root, 'lib/vite.config.ts'), 300, 300)
  writeFileSync(join(root, 'lib/dist/index.js'), 'rebuilt')
  utimesSync(join(root, 'lib/dist/index.js'), Date.now() / 1000 + 60, Date.now() / 1000 + 60)
  assert.equal(buildState(root, lib), 'current')
})

test('build: stylesheets, assets and templates outside src are inputs; test scaffolding, docs and nested packages are not', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-files-'))
  const lib = unit('lib')
  configured(root, 'lib', {src: 100, dist: 200})
  for (const file of ['styles/base.css', 'icons.css', 'templates/page.html', 'test/a.test.mjs', 'browser/a.spec.ts', 'fixtures/a.json']) {
    mkdirSync(dirname(join(root, 'lib', file)), {recursive: true})
    writeFileSync(join(root, 'lib', file), '')
  }
  writeFileSync(join(root, 'lib/scenarios.json'), '{}')
  writeFileSync(join(root, 'lib/README.md'), '')
  mkdirSync(join(root, 'lib/nested/src'), {recursive: true})
  writeFileSync(join(root, 'lib/nested/package.json'), '{}')
  writeFileSync(join(root, 'lib/nested/src/index.ts'), '')
  assert.deepEqual(buildInputs(root, lib), [
    'lib/build/assets.mjs',
    'lib/icons.css',
    'lib/package.json',
    'lib/scripts/css.mjs',
    'lib/styles/base.css',
    'lib/templates/page.html',
    'lib/tsconfig.json',
    'tsconfig.base.json',
  ])
  built(root, lib, () => writeFileSync(join(root, 'lib/dist/index.js'), 'built'))
  utimesSync(join(root, 'lib/dist/index.js'), 200, 200)
  // Recorded, its inputs' content decides: an edited stylesheet makes it stale.
  assert.equal(buildState(root, lib), 'current')
  writeFileSync(join(root, 'lib/styles/base.css'), '.a {}')
  assert.equal(staleness(root, [lib], lib, new Set()), 'its build inputs changed since its last build')
  writeFileSync(join(root, 'lib/styles/base.css'), '')
  for (const file of ['test/a.test.mjs', 'browser/a.spec.ts', 'fixtures/a.json', 'scenarios.json', 'README.md', 'nested/src/index.ts']) {
    writeFileSync(join(root, 'lib', file), 'edited')
    assert.equal(buildState(root, lib), 'current', file)
  }
})

test('build: a dependency rebuilt from changed inputs into the same outputs still makes what depends on it stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-changed-'))
  const lib = unit('lib')
  const app = unit('app', {dependsOn: ['lib']})
  const units = [lib, app]
  configured(root, 'lib', {src: 100, dist: 200})
  mkdirSync(join(root, 'lib/styles'), {recursive: true})
  writeFileSync(join(root, 'lib/styles/base.css'), '.a {}')
  workspace(root, 'app', {src: 100, dist: 300})
  // Its first recorded build: no earlier inputs to compare, so what depends on it stays current.
  built(root, lib, () => writeFileSync(join(root, 'lib/dist/index.js'), 'built'))
  utimesSync(join(root, 'lib/dist/index.js'), 200, 200)
  assert.equal(staleness(root, units, app, new Set()), undefined)
  // A stylesheet edit: built again, its dist comes out the same and keeps its times, but app may bundle the stylesheet.
  writeFileSync(join(root, 'lib/styles/base.css'), '.a { color: red }')
  assert.equal(
    built(root, lib, () => writeFileSync(join(root, 'lib/dist/index.js'), 'built')),
    true,
  )
  assert.equal(statSync(join(root, 'lib/dist/index.js')).mtimeMs, 200_000)
  assert.equal(staleness(root, units, app, new Set()), 'lib was built after it')
  // Built again from the same inputs, it changes nothing more: app, rebuilt since, stays current.
  utimesSync(join(root, 'app/dist/index.js'), Date.now() / 1000 + 60, Date.now() / 1000 + 60)
  built(root, lib, () => writeFileSync(join(root, 'lib/dist/index.js'), 'built'))
  assert.equal(staleness(root, units, app, new Set()), undefined)
})

test("build: a shared tsconfig a workspace's own config extends through another of its files is an input", () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-extends-'))
  const lib = unit('lib')
  configured(root, 'lib', {src: 100, dist: 200})
  mkdirSync(join(root, 'lib/config'), {recursive: true})
  writeFileSync(join(root, 'lib/tsconfig.json'), '{"extends": "./config/compiler.json"}')
  writeFileSync(join(root, 'lib/config/compiler.json'), '{"extends": "../../tsconfig.base.json"}')
  assert.ok(buildInputs(root, lib).includes('lib/config/compiler.json'))
  assert.ok(buildInputs(root, lib).includes('tsconfig.base.json'))
})

test('build: in a git checkout, files git ignores are not inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-git-'))
  const lib = unit('lib')
  configured(root, 'lib', {src: 100, dist: 200})
  writeFileSync(join(root, '.gitignore'), 'dist/\ngenerated.css\n')
  writeFileSync(join(root, 'lib/styles.css'), '')
  writeFileSync(join(root, 'lib/generated.css'), '')
  assert.equal(spawnSync('git', ['init', '--quiet'], {cwd: root}).status, 0)
  assert.ok(buildInputs(root, lib).includes('lib/styles.css'))
  assert.ok(!buildInputs(root, lib).includes('lib/generated.css'))
})

test('build: a recorded output gone missing, or a deleted source, makes a built workspace stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'tools-outputs-'))
  const lib = unit('lib')
  configured(root, 'lib', {src: 100, dist: 200})
  writeFileSync(join(root, 'lib/src/extra.ts'), '')
  utimesSync(join(root, 'lib/src/extra.ts'), 100, 100)
  utimesSync(join(root, 'lib/src'), 100, 100)
  built(root, lib, () => writeFileSync(join(root, 'lib/dist/styles.css'), ''))
  assert.equal(buildState(root, lib), 'current')
  unlinkSync(join(root, 'lib/dist/styles.css'))
  assert.equal(staleness(root, [lib], lib, new Set()), 'lib/dist/styles.css is missing')
  // Rebuilt with the same bytes, its outputs keep their times and it is current by the recorded check.
  writeFileSync(join(root, 'lib/dist/styles.css'), '')
  utimesSync(join(root, 'lib/dist/styles.css'), 200, 200)
  assert.equal(
    built(root, lib, () => writeFileSync(join(root, 'lib/dist/index.js'), ''), 300_000),
    true,
  )
  assert.equal(statSync(join(root, 'lib/dist/index.js')).mtimeMs, 200_000)
  assert.equal(buildState(root, lib), 'current')
  unlinkSync(join(root, 'lib/src/extra.ts'))
  assert.equal(staleness(root, [lib], lib, new Set()), 'src is newer than dist')
})

test('test --filter narrows each runner to the matching tests, and needs a target', () => {
  const fixture = fileURLToPath(new URL('fixtures/repo/', import.meta.url))
  const runs = testPlan(fixture, {target: 'app', rust: true, filter: 'parses'}).runs.map(run => run.command)
  assert.deepEqual(
    runs.map(command => command.argv.join(' ')),
    ['npm test --workspace @fixture/app', 'cargo test --locked -p fixture-app parses'],
  )
  assert.match(runs[0]?.env?.NODE_OPTIONS ?? '', /--test-name-pattern="parses"/u)
  assert.throws(() => testPlan(fixture, {filter: 'parses'}), /needs a target/u)
})

test('test --filter: node --test with named files runs only the matching tests', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tools-filter-'))
  writeFileSync(join(directory, 'a.test.mjs'), "import test from 'node:test'\ntest('alpha one', () => {})\ntest('beta', () => {})\n")
  // As a workspace's script runs it: the files named, the pattern from the environment.
  // Without the outer test runner's context, which makes a nested node --test skip its files.
  const {NODE_TEST_CONTEXT: _context, ...env} = process.env
  const ran = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'a.test.mjs'], {
    cwd: directory,
    env: {...env, NODE_OPTIONS: nodeTestPattern('alpha one')},
    encoding: 'utf8',
  })
  assert.equal(ran.status, 0, ran.stderr)
  assert.match(ran.stdout, /^# tests 1$/mu)
  assert.match(ran.stdout, /ok 1 - alpha one/u)
})
