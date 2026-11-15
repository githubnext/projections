import assert from 'node:assert/strict'
import test from 'node:test'
import {selectParts} from '../src/commands/install.ts'
import {UsageError} from '../src/commands/work/change-set.ts'
import {devVersion, findEditor, pointAtTarball, tarballSpec, vsceTarget, withoutNpmConfig} from '../src/lib/install.ts'

test('devVersion: the base release, the commit, and a timestamp only for uncommitted changes', () => {
  const now = new Date('2026-11-10T21:07:44.288Z')
  assert.equal(devVersion('0.4.0', 'a1b2c3d', false, now), '0.4.0-dev.a1b2c3d')
  assert.equal(devVersion('0.4.0', 'a1b2c3d', true, now), '0.4.0-dev.a1b2c3d.dirty.20261110210744')
  assert.equal(devVersion('0.4.0-rc.1+build', 'a1b2c3d', false, now), '0.4.0-dev.a1b2c3d')
  // An all-digit hash would be a numeric identifier with a leading zero, which semver rejects.
  assert.equal(devVersion('0.0.0', '0123456', false, now), '0.0.0-dev.g0123456')
})

test("vsceTarget: Node's names to vsce's, and none for unsupported platforms", () => {
  assert.equal(vsceTarget('darwin', 'arm64'), 'darwin-arm64')
  assert.equal(vsceTarget('linux', 'arm'), 'linux-armhf')
  assert.equal(vsceTarget('win32', 'x64'), 'win32-x64')
  assert.equal(vsceTarget('freebsd', 'x64'), undefined)
})

test(
  'tarballSpec: relative when the project and checkout share a directory, absolute otherwise',
  {skip: process.platform === 'win32'},
  () => {
    assert.equal(tarballSpec('/work/site/renderer', '/work/projections/dist/dogfood/p.tgz'), 'file:../../projections/dist/dogfood/p.tgz')
    assert.equal(tarballSpec('/tmp/scratch/renderer', '/work/projections/dist/dogfood/p.tgz'), 'file:/work/projections/dist/dogfood/p.tgz')
  },
)

test('pointAtTarball: sets the dependency where it is, and removes only a conflicting override', () => {
  const spec = 'file:../p.tgz'
  const scaffolded = {
    dependencies: {'@githubnext/projections': '^0.0.0', react: '^19.1.0'},
    overrides: {'@githubnext/projections': 'file:/old/p.tgz'},
  }
  const {manifest, changes} = pointAtTarball(scaffolded, spec)
  assert.deepEqual(manifest, {dependencies: {'@githubnext/projections': spec, react: '^19.1.0'}})
  assert.equal(changes.length, 2)
  assert.equal(scaffolded.dependencies['@githubnext/projections'], '^0.0.0', 'the input is not modified')

  const kept = pointAtTarball(
    {devDependencies: {'@githubnext/projections': '1.0.0'}, overrides: {'@githubnext/projections': spec, x: '1'}},
    spec,
  )
  assert.deepEqual(kept.manifest, {
    devDependencies: {'@githubnext/projections': spec},
    overrides: {'@githubnext/projections': spec, x: '1'},
  })

  assert.deepEqual(pointAtTarball({name: 'empty'}, spec).manifest, {name: 'empty', dependencies: {'@githubnext/projections': spec}})
  assert.deepEqual(pointAtTarball(manifest, spec).changes, [], 'running it again changes nothing')
  // npm saves file: specifiers relative; the same file is the same dependency.
  const saved = {
    dependencies: {'@githubnext/projections': 'file:../work/p.tgz'},
    overrides: {'@githubnext/projections': 'file:../work/p.tgz'},
  }
  assert.deepEqual(pointAtTarball(saved, 'file:/work/p.tgz', '/site').changes, [])
})

test("withoutNpmConfig: the project's npm doesn't inherit this workspace's npm run configuration", () => {
  const environment = withoutNpmConfig({
    PATH: '/bin',
    npm_config_registry: 'https://x/',
    NPM_CONFIG_CACHE: '/c',
    npm_package_name: 'w',
    HOME: '/h',
  })
  assert.deepEqual(environment, {PATH: '/bin', HOME: '/h'})
})

test('findEditor: none installs nowhere; auto prefers code, then code-insiders', () => {
  const only = (name: string) => (path: string) => path.endsWith(`/${name}`) || path.endsWith(`\\${name}.cmd`)
  const original = process.env['PATH']
  process.env['PATH'] = process.platform === 'win32' ? 'C:\\bin' : '/opt/bin'
  try {
    assert.equal(
      findEditor('none', () => true),
      undefined,
    )
    assert.equal(findEditor('auto', () => true)?.name, 'code')
    assert.equal(findEditor('auto', only('code-insiders'))?.name, 'code-insiders')
    assert.equal(findEditor('code', only('code-insiders')), undefined)
  } finally {
    process.env['PATH'] = original
  }
})

test('selectParts: every part by default, in install order, and unknown parts are usage errors', () => {
  assert.deepEqual(selectParts(undefined), ['cli', 'vscode', 'npm'])
  assert.deepEqual(selectParts(['npm,cli']), ['cli', 'npm'])
  assert.throws(() => selectParts(['vsix']), UsageError)
})
