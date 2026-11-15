import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {affected, kindsOf} from '../src/lib/affected.ts'
import {
  cargoMembers,
  dependantsOf,
  findUnit,
  inDependencyOrder,
  loadUnits,
  npmWorkspaces,
  ownerOf,
  parseCrate,
  readmeProblems,
} from '../src/lib/packages.ts'
import type {Generator} from '../src/lib/generated.ts'

const fixture = fileURLToPath(new URL('fixtures/repo/', import.meta.url))

test('workspaces and crates come from package.json and Cargo.toml', () => {
  assert.deepEqual(npmWorkspaces(fixture), ['app', 'libs/a', 'libs/b'])
  assert.deepEqual(cargoMembers(fixture), ['core', 'app'])
})

test('crate path dependencies are inline tables; [[bin]] paths are not dependencies', () => {
  const crate = parseCrate(
    '[package]\nname = "x"\n\n[[bin]]\npath = "src/main.rs"\n\n[dependencies]\na = { path = "../a" }\nb = "1"\n[dev-dependencies]\nc = { version = "1", path = "../../c" }\n',
  )
  assert.deepEqual(crate, {name: 'x', paths: ['../a', '../../c']})
})

test('the map merges an npm workspace and crate in one directory and links dependencies', () => {
  const units = loadUnits(fixture)
  assert.deepEqual(
    units.map(unit => [unit.path, unit.kinds.join('+'), unit.names.join(','), unit.source, unit.dependsOn.join(',')]),
    [
      ['app', 'npm+crate', '@fixture/app,fixture-app', 'first-paragraph', 'core,libs/a'],
      ['core', 'crate', 'fixture-core', 'front-matter', ''],
      ['libs/a', 'npm', '@fixture/lib-a', 'front-matter', ''],
      ['libs/b', 'npm', '@fixture/lib-b', 'missing', 'libs/a'],
    ],
  )
  assert.equal(units.find(unit => unit.path === 'app')?.description, 'The app, with code and a link.')
  assert.equal(units.find(unit => unit.path === 'libs/a')?.description, 'Library A: shared helpers')
  assert.deepEqual(units.find(unit => unit.path === 'app')?.scripts, ['build', 'test'])
})

test('README problems: a missing README and a first-paragraph fallback both fail', () => {
  assert.deepEqual(
    readmeProblems(loadUnits(fixture)).map(problem => [problem.file, problem.message.split(' ')[0]]),
    [
      ['app/README.md', 'README.md'],
      ['libs/b/README.md', 'npm'],
    ],
  )
})

test('owners, lookup, dependants and dependency order', () => {
  const units = loadUnits(fixture)
  assert.equal(ownerOf(units, 'app/src/main.ts')?.path, 'app')
  assert.equal(
    ownerOf(units, 'libs/a'),
    units.find(unit => unit.path === 'libs/a'),
  )
  assert.equal(ownerOf(units, 'docs/guide.md'), undefined)
  assert.equal(ownerOf(units, 'libs/ab/x.ts'), undefined)
  assert.equal(findUnit(units, '@fixture/lib-a')?.path, 'libs/a')
  assert.equal(findUnit(units, 'fixture-core')?.path, 'core')
  assert.equal(findUnit(units, './libs/b/')?.path, 'libs/b')
  assert.deepEqual(dependantsOf(units, ['libs/a']), ['app', 'libs/b'])
  assert.deepEqual(dependantsOf(units, ['core']), ['app'])
  assert.deepEqual(inDependencyOrder(units, ['app', 'libs/a', 'core']), ['core', 'libs/a', 'app'])
})

test('affected: owners, transitive dependants, unowned files, regeneration and change kinds', () => {
  const units = loadUnits(fixture)
  const registry: Generator[] = [
    {
      name: 'gen',
      description: '',
      outputs: ['gen/out.ts'],
      inputs: ['core/**', 'gen/**'],
      generate: [{argv: ['node', 'scripts/gen.mjs']}],
      check: {mode: 'snapshot'},
      needs: [],
      fix: true,
    },
    {name: 'other', description: '', outputs: ['x'], inputs: ['libs/b/**'], generate: [], check: {mode: 'snapshot'}, needs: [], fix: true},
  ]
  const result = affected(
    units,
    [
      {path: 'core/src/lib.rs', status: 'modified'},
      {path: 'docs/guide.md', status: 'modified'},
      {path: 'gen/out.ts', status: 'modified'},
    ],
    registry,
  )
  assert.deepEqual(result.changed, ['core'])
  assert.deepEqual(result.dependants, ['app'])
  assert.deepEqual(result.unowned, ['docs/guide.md', 'gen/out.ts'])
  // Editing an output is not a reason to regenerate it; editing an input is.
  assert.deepEqual(
    result.regenerate.map(generator => generator.name),
    ['gen'],
  )
  assert.equal(result.regenerate[0]?.generate, 'node scripts/gen.mjs')
  assert.deepEqual(result.kinds, ['docs', 'rust', 'ts'])
  assert.deepEqual(affected(units, [], registry), {changed: [], dependants: [], unowned: [], regenerate: [], kinds: []})
})

test('change kinds select gates', () => {
  assert.deepEqual(kindsOf(['a/Cargo.toml']), ['rust'])
  assert.deepEqual(kindsOf(['x/package.json', 'package-lock.json']), ['manifests'])
  assert.deepEqual(kindsOf(['rules/x.comparator.yaml']), ['comparators'])
  assert.deepEqual(kindsOf(['.github/workflows/ci.yml']), ['workflows'])
})
