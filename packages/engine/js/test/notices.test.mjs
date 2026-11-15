import assert from 'node:assert/strict'
import test from 'node:test'
import {compiledCrates} from '../../../../tools/scripts/crate-notices.mjs'
import {readmeTable, versionProblems, withTable} from '../../../../tools/scripts/notices.mjs'

const registry = 'registry+https://github.com/rust-lang/crates.io-index'
const crate = (name, version, own) => ({
  id: `${registry}#${name}@${version}`,
  name,
  version,
  source: registry,
  manifest_path: `/registry/${name}-${version}/Cargo.toml`,
  repository: `https://github.com/example/${name}`,
  own,
})
const normal = [{kind: null}]

/** Cargo metadata for a workspace crate `app` whose normal dependencies are `crates` and whose dev-dependency is `dev`. */
function metadata(crates, dev = crate('dev-only', '1.0.0', false)) {
  const app = {id: 'path+file:///repo#app@0.1.0', name: 'app', version: '0.1.0', source: null, manifest_path: '/repo/Cargo.toml'}
  return {
    packages: [app, ...crates, dev],
    resolve: {
      nodes: [
        {
          id: app.id,
          deps: [...crates.map(pkg => ({pkg: pkg.id, dep_kinds: normal})), {pkg: dev.id, dep_kinds: [{kind: 'dev'}]}],
        },
        ...[...crates, dev].map(pkg => ({id: pkg.id, deps: []})),
      ],
    },
  }
}

const manifest = (crates, directory = 'upstream') => [
  {directory, crates, repository: 'https://github.com/example/upstream', tag: 'v1', files: {LICENSE: 'LICENSE'}},
]
const problems = (entries, crates) => versionProblems(entries, compiledCrates(metadata(crates), ['app']).values(), pkg => pkg.own)

test('a crate without license files at a covered version passes; dev-dependencies never count', () => {
  assert.deepEqual(problems(manifest({cel: ['0.15.0']}), [crate('cel', '0.15.0', false), crate('serde', '1.0.0', true)]), [])
})

test('a crate locked at a version the manifest doesn’t cover names both versions and the fix, once', () => {
  const found = problems(manifest({cel: ['0.15.0']}), [crate('cel', '0.16.0', false)])
  assert.equal(found.length, 1)
  assert.match(found[0], /cel is locked at 0\.16\.0, but notices\/notices\.json covers cel 0\.15\.0/)
  assert.match(
    found[0],
    /fetch the license from https:\/\/github\.com\/example\/upstream at the matching tag and update notices\/notices\.json/,
  )
})

test('a crate the manifest has no entry for fails, naming its repository', () => {
  const [found] = problems([], [crate('cel', '0.15.0', false)])
  assert.match(found, /cel 0\.15\.0 ships no license files and notices\/notices\.json has no entry for it/)
  assert.match(found, /https:\/\/github\.com\/example\/cel/)
})

test('an entry no compiled crate needs is stale', () => {
  assert.deepEqual(problems(manifest({json5: ['0.4.1']}), [crate('json5', '0.4.1', true)]), [
    'notices/notices.json covers json5 0.4.1, but json5 0.4.1 ships its own license files: remove 0.4.1 from notices/notices.json (and notices/upstream/ once it covers nothing)',
  ])
  assert.match(problems(manifest({gone: ['1.0.0']}), [])[0], /covers gone 1\.0\.0, but no build compiles in gone:/)
  assert.match(problems(manifest({'dev-only': ['1.0.0']}), [])[0], /no build compiles in dev-only:/)
})

test('of two locked versions, only the one without license files needs covering', () => {
  const locked = [crate('wasmparser', '0.228.0', false), crate('wasmparser', '0.263.0', true)]
  assert.deepEqual(problems(manifest({wasmparser: ['0.228.0']}), locked), [])
  assert.deepEqual(problems(manifest({wasmparser: ['0.228.0', '0.263.0']}), locked), [
    'notices/notices.json covers wasmparser 0.263.0, but wasmparser 0.263.0 ships its own license files: remove 0.263.0 from notices/notices.json (and notices/upstream/ once it covers nothing)',
  ])
})

test('the README table is written from the manifest, and rewriting it is stable', () => {
  const entries = [
    {
      directory: 'yaml-rust2',
      crates: {'yaml-rust2': ['0.13.0']},
      repository: 'https://github.com/Ethiraric/yaml-rust2',
      tag: 'v0.13.0',
      files: {'LICENSE-MIT': 'MIT-LICENSE'},
    },
  ]
  assert.match(readmeTable(entries), /\| `yaml-rust2\/` \| `yaml-rust2` 0\.13\.0 \| `LICENSE-MIT` \(upstream `MIT-LICENSE`\) \|/)
  const readme = withTable('intro\n<!-- generated: notices -->\nold\n<!-- end generated: notices -->\nafter\n', entries)
  assert.ok(readme.startsWith('intro\n<!-- generated: notices -->\n<!-- prettier-ignore -->\n'))
  assert.ok(readme.endsWith('\n<!-- end generated: notices -->\nafter\n'))
  assert.equal(withTable(readme, entries), readme)
})
