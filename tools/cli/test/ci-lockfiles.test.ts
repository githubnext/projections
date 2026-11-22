import assert from 'node:assert/strict'
import test from 'node:test'
import {cargoLockfileReach, npmLockfileReach, parseCargoLock} from '../src/lib/ci-lockfiles.ts'
import type {Unit} from '../src/lib/packages.ts'

const unit = (path: string, kinds: Unit['kinds'], names: string[]): Unit => ({
  path,
  kinds,
  names,
  readme: undefined,
  description: undefined,
  source: 'missing',
  dependsOn: [],
  scripts: [],
})
const units = [
  unit('packages/a', ['npm'], ['@x/a']),
  unit('packages/b', ['npm'], ['@x/b']),
  unit('crates/core', ['crate'], ['core']),
  unit('crates/app', ['crate'], ['app']),
]

const npm = (overrides: Record<string, object | undefined> = {}) =>
  JSON.stringify({
    lockfileVersion: 3,
    packages: Object.fromEntries(
      Object.entries<object | undefined>({
        '': {workspaces: ['packages/*'], devDependencies: {eslint: '^9'}},
        'packages/a': {dependencies: {foo: '^1', '@x/b': '*'}},
        'packages/b': {dependencies: {bar: '^1'}},
        'node_modules/@x/a': {resolved: 'packages/a', link: true},
        'node_modules/@x/b': {resolved: 'packages/b', link: true},
        'node_modules/foo': {version: '1.0.0', dependencies: {baz: '^1'}},
        'node_modules/foo/node_modules/baz': {version: '1.5.0'},
        'node_modules/baz': {version: '2.0.0'},
        'node_modules/bar': {version: '1.0.0', dependencies: {baz: '^2'}},
        'node_modules/eslint': {version: '9.0.0'},
        ...overrides,
      }).filter(([, entry]) => entry !== undefined),
    ),
  })

test("an npm lockfile change reaches the workspaces whose resolved dependencies changed, by Node's resolution", () => {
  assert.deepEqual(npmLockfileReach(npm(), npm({'node_modules/foo': {version: '1.0.1', dependencies: {baz: '^1'}}}), units), {
    units: ['packages/a'],
    root: false,
  })
  // foo's own baz, nested, is a's alone; the hoisted one is b's (and a's only through b, which the unit graph follows).
  assert.deepEqual(npmLockfileReach(npm(), npm({'node_modules/foo/node_modules/baz': {version: '1.6.0'}}), units).units, ['packages/a'])
  assert.deepEqual(npmLockfileReach(npm(), npm({'node_modules/baz': {version: '2.1.0'}}), units).units, ['packages/b'])
  // A removed package reaches what depended on it before.
  assert.deepEqual(
    npmLockfileReach(npm(), npm({'node_modules/foo/node_modules/baz': undefined, 'node_modules/foo': {version: '1.1.0'}}), units).units,
    ['packages/a'],
  )
  assert.deepEqual(npmLockfileReach(npm(), npm(), units), {units: [], root: false})
})

test("an npm lockfile change to the root's own dependencies says so", () => {
  assert.deepEqual(npmLockfileReach(npm(), npm({'node_modules/eslint': {version: '9.1.0'}}), units), {units: [], root: true})
  // A new workspace changes the root entry's list of them, not its dependencies.
  assert.deepEqual(npmLockfileReach(npm(), npm({'': {workspaces: ['packages/*', 'tools/*'], devDependencies: {eslint: '^9'}}}), units), {
    units: [],
    root: false,
  })
})

const cargo = (anyhow = '1.0.0', serde = '1.0.0') => `version = 4

[[package]]
name = "anyhow"
version = "${anyhow}"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${anyhow}"

[[package]]
name = "app"
version = "0.1.0"
dependencies = [
 "anyhow",
 "core",
]

[[package]]
name = "core"
version = "0.1.0"
dependencies = [
 "serde 1.0.0",
]

[[package]]
name = "serde"
version = "${serde}"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${serde}"
`

test('Cargo.lock blocks parse to names, versions, sources and dependencies', () => {
  assert.deepEqual(
    parseCargoLock(cargo()).map(({name, version, source, dependencies}) => [name, version, source, dependencies.join(',')]),
    [
      ['anyhow', '1.0.0', 'registry+https://github.com/rust-lang/crates.io-index', ''],
      ['app', '0.1.0', undefined, 'anyhow,core'],
      ['core', '0.1.0', undefined, 'serde 1.0.0'],
      ['serde', '1.0.0', 'registry+https://github.com/rust-lang/crates.io-index', ''],
    ],
  )
})

test('a Cargo dependency with a source resolves to the package from that source, not another of the same version', () => {
  const git = 'git+https://example.com/dep#abc'
  const lock = (gitChecksum: string) => `version = 4

[[package]]
name = "app"
version = "0.1.0"
dependencies = [
 "dep 1.0.0 (${git})",
]

[[package]]
name = "core"
version = "0.1.0"
dependencies = [
 "dep 1.0.0 (registry+https://github.com/rust-lang/crates.io-index)",
]

[[package]]
name = "dep"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "registry"

[[package]]
name = "dep"
version = "1.0.0"
source = "${git}"
checksum = "${gitChecksum}"
`
  assert.deepEqual(cargoLockfileReach(lock('a'), lock('b'), units).units, ['crates/app'])
})

test('a Cargo.lock change reaches the crates whose resolved dependencies changed', () => {
  assert.deepEqual(cargoLockfileReach(cargo(), cargo('1.0.1'), units), {units: ['crates/app'], root: false})
  // core's dependency on serde changes with it, so core's block changes too; app reaches it through the unit graph.
  assert.deepEqual(cargoLockfileReach(cargo(), cargo('1.0.0', '1.0.1').replace('serde 1.0.0', 'serde 1.0.1'), units).units, ['crates/core'])
  assert.deepEqual(cargoLockfileReach(cargo(), cargo(), units).units, [])
})
