import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import test from 'node:test'
import {table, tagVersion} from '../src/lib/release.ts'
import {setReleaseVersion} from '../src/lib/release-bump.ts'
import {versionProblems} from '../src/lib/release-check.ts'

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

/** A workspace at 0.1.0: two released crates and npm workspaces in packages/, an example and a tool that never release. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'tools-release-'))
  const files: Record<string, string> = {
    'Cargo.toml':
      '[workspace]\nmembers = ["packages/engine", "packages/sdk", "examples/demo"]\n\n[workspace.package]\nversion = "0.1.0"\nedition = "2024"\n',
    'packages/engine/Cargo.toml': '[package]\nname = "engine"\nversion.workspace = true\n',
    'packages/sdk/Cargo.toml':
      '[package]\nname = "sdk"\nversion.workspace = true\n\n[dependencies]\nengine = { path = "../engine", version = "0.1.0", default-features = false }\nserde = { version = "0.1.0" }\n',
    'examples/demo/Cargo.toml':
      '[package]\nname = "demo"\nversion = "0.0.0"\npublish = false\n\n[dependencies]\nsdk = { path = "../../packages/sdk" }\n',
    'Cargo.lock':
      '# generated\nversion = 4\n\n[[package]]\nname = "demo"\nversion = "0.0.0"\n\n[[package]]\nname = "engine"\nversion = "0.1.0"\n\n[[package]]\nname = "sdk"\nversion = "0.1.0"\ndependencies = [\n "engine",\n]\n\n[[package]]\nname = "serde"\nversion = "0.1.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n',
    'package.json': json({name: 'root', version: '0.0.0', private: true, workspaces: ['packages/js/*', 'tools/cli']}),
    'packages/js/core/package.json': json({name: '@x/core', version: '0.1.0', private: true, dependencies: {left: '^0.1.0'}}),
    'packages/js/sdk/package.json': json({name: '@x/sdk', version: '0.1.0', devDependencies: {'@x/core': '0.1.0'}}),
    'tools/cli/package.json': json({name: '@x/tools', version: '0.0.0', private: true, dependencies: {'@x/sdk': '0.1.0'}}),
  }
  const lockPackages = Object.fromEntries(
    Object.entries(files)
      .filter(([file]) => file !== 'package.json' && file.endsWith('package.json'))
      .map(([file, text]) => {
        const {name, version, dependencies, devDependencies} = JSON.parse(text) as {
          name: string
          version: string
          dependencies?: Record<string, string>
          devDependencies?: Record<string, string>
        }
        return [dirname(file), {name, version, ...(dependencies && {dependencies}), ...(devDependencies && {devDependencies})}]
      }),
  )
  files['package-lock.json'] = json({name: 'root', lockfileVersion: 3, packages: {'': {name: 'root'}, ...lockPackages}})
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), {recursive: true})
    writeFileSync(join(root, file), text)
  }
  return root
}

const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8')

test('a release tag names its version', () => {
  assert.equal(tagVersion('v0.1.0'), '0.1.0')
  assert.equal(tagVersion('v0.2.0-beta.1'), '0.2.0-beta.1')
  assert.equal(tagVersion('0.1.0'), undefined)
  assert.equal(tagVersion('v0'), undefined)
})

test('a TOML table is found by its literal name', () => {
  const text = '[a+b]\nx = 1\n[aab]\ny = 2\n[a\\b]\nz = 3\n[a.b]\nw = 4\n'
  assert.equal(table(text, 'a+b')?.body, '\nx = 1\n')
  assert.equal(table(text, 'a\\b')?.body, '\nz = 3\n')
  assert.equal(table(text, 'a.b')?.body, '\nw = 4\n')
  assert.equal(table(text, 'a*'), undefined)
})

test('setting the version changes every shipped manifest, their dependencies and both lockfiles, and nothing else', () => {
  const root = repository()
  try {
    assert.deepEqual(versionProblems(root, 'v0.1.0'), [])
    const changed = setReleaseVersion(root, '0.2.0')
    assert.deepEqual(changed.sort(), [
      'Cargo.lock',
      'Cargo.toml',
      'package-lock.json',
      'packages/js/core/package.json',
      'packages/js/sdk/package.json',
      'packages/sdk/Cargo.toml',
      'tools/cli/package.json',
    ])
    assert.match(read(root, 'Cargo.toml'), /\[workspace\.package\]\nversion = "0\.2\.0"\n/)
    assert.match(
      read(root, 'packages/sdk/Cargo.toml'),
      /engine = \{ path = "\.\.\/engine", version = "0\.2\.0", default-features = false \}/,
    )
    assert.match(read(root, 'packages/sdk/Cargo.toml'), /serde = \{ version = "0\.1\.0" \}/, 'registry dependencies keep theirs')
    const lock = read(root, 'Cargo.lock')
    assert.match(lock, /name = "engine"\nversion = "0\.2\.0"/)
    assert.match(lock, /name = "demo"\nversion = "0\.0\.0"/, 'examples are never released')
    assert.match(lock, /name = "serde"\nversion = "0\.1\.0"/)
    assert.equal(
      read(root, 'packages/js/sdk/package.json'),
      json({name: '@x/sdk', version: '0.2.0', devDependencies: {'@x/core': '0.2.0'}}),
    )
    assert.equal(
      read(root, 'tools/cli/package.json'),
      json({name: '@x/tools', version: '0.0.0', private: true, dependencies: {'@x/sdk': '0.2.0'}}),
      'tools stay at 0.0.0 and depend on the new version',
    )
    assert.deepEqual(JSON.parse(read(root, 'package-lock.json')).packages['packages/js/core'], {
      name: '@x/core',
      version: '0.2.0',
      dependencies: {left: '^0.1.0'},
    })
    assert.deepEqual(versionProblems(root, 'v0.2.0'), [])
    assert.deepEqual(
      versionProblems(root, 'v0.1.0').map(problem => problem.message),
      ['The tag is v0.1.0, but the release version is 0.2.0'],
    )
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('a shipped manifest, dependency or lockfile that disagrees is a problem', () => {
  const root = repository()
  try {
    writeFileSync(
      join(root, 'packages/js/sdk/package.json'),
      json({name: '@x/sdk', version: '0.1.1', devDependencies: {'@x/core': '^0.1.0'}}),
    )
    writeFileSync(join(root, 'tools/cli/package.json'), json({name: '@x/tools', version: '0.1.0', dependencies: {'@x/sdk': '0.1.0'}}))
    writeFileSync(
      join(root, 'Cargo.lock'),
      read(root, 'Cargo.lock').replace('name = "engine"\nversion = "0.1.0"', 'name = "engine"\nversion = "0.0.9"'),
    )
    const messages = versionProblems(root).map(problem => `${problem.file}: ${problem.message}`)
    assert.deepEqual(messages, [
      'Cargo.lock: Cargo.lock has engine 0.0.9, not 0.1.0: run cargo update --workspace',
      'packages/js/sdk/package.json: @x/sdk is 0.1.1, not the release version 0.1.0',
      'tools/cli/package.json: @x/tools is outside packages/, so it is never released: it stays at 0.0.0',
      'tools/cli/package.json: @x/tools is outside packages/, so it is never released: set "private": true',
      'packages/js/sdk/package.json: @x/sdk depends on @x/core ^0.1.0; workspaces depend on each other at their exact version, 0.1.0',
      'tools/cli/package.json: @x/tools depends on @x/sdk 0.1.0; workspaces depend on each other at their exact version, 0.1.1',
      'package-lock.json: package-lock.json records @x/sdk (packages/js/sdk) at another version or with other workspace dependencies: run npm install --package-lock-only',
      'package-lock.json: package-lock.json records @x/tools (tools/cli) at another version or with other workspace dependencies: run npm install --package-lock-only',
    ])
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
