import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {schemaBaseUrl} from '../dist/index.js'
import {publication, releaseFiles, releaseVersion} from '../scripts/publication.mjs'

test('the committed schemas are a complete set at the schemas host', async () => {
  const {base, files, problems} = await publication()
  assert.deepEqual(problems, [])
  assert.equal(base, 'https://schemas.projections.githubnext.com/')
  assert.equal(base, schemaBaseUrl)
  assert.ok(files.some(({path}) => path === 'extraction/v0.json'))
  assert.ok(files.some(({path}) => path === 'vocabularies/runtime-policy/v0.json'))
})

test('a release publishes immutable snapshots, and a stable release also replaces each schema at its ID', async () => {
  const {files} = await publication()
  const stable = releaseFiles(files, 'v0.2.0')
  assert.equal(stable.version, '0.2.0')
  assert.equal(stable.prerelease, false)
  assert.deepEqual(
    stable.snapshots.map(({path}) => path),
    files.map(({path}) => path.replace(/\.json$/u, '/0.2.0.json')),
  )
  assert.ok(stable.snapshots.some(({path}) => path === 'graph/v0/0.2.0.json'))
  assert.ok(stable.snapshots.some(({path}) => path === 'vocabularies/runtime-policy/v0/0.2.0.json'))
  assert.deepEqual(stable.current, files)
  for (const [index, {bytes}] of stable.snapshots.entries()) assert.equal(bytes, files[index].bytes)

  const prerelease = releaseFiles(files, 'projections-cli/v0.3.0-beta.1')
  assert.equal(prerelease.version, '0.3.0-beta.1')
  assert.equal(prerelease.prerelease, true)
  assert.ok(prerelease.snapshots.some(({path}) => path === 'extraction/v0/0.3.0-beta.1.json'))
  assert.deepEqual(prerelease.current, [])
})

test('only release versions name snapshots', () => {
  assert.deepEqual(releaseVersion('0.1.0'), {version: '0.1.0', prerelease: false})
  for (const tag of ['latest', 'v1', 'v1.2', 'v01.2.3', 'v1.2.3+build', 'v1.2.3/../x', '../v1.2.3-x/y']) {
    assert.throws(() => releaseVersion(tag), /not a release version/u, tag)
  }
})

test('nothing in the repository uses the retired schema base', () => {
  const retired = ['projections.githubnext.com', 'schemas/'].join('/')
  const result = spawnSync('git', ['grep', '-l', '--fixed-strings', retired, '--', '.'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    encoding: 'utf8',
  })
  if (result.error || result.status === 128) return // Not a Git checkout, such as an unpacked package.
  assert.equal(result.stdout, '', `use ${schemaBaseUrl} instead of https://${retired}`)
})
