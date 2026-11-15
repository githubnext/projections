import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {chmod, copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'

const source = fileURLToPath(new URL('../../../tools/gh-projections/gh-projections', import.meta.url))
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'projections-launcher-')))
  t.after(() => rm(root, {recursive: true, force: true}))
  // A source checkout's layout: the launcher in tools/gh-projections/, the CLI in packages/cli/dist/.
  await mkdir(path.join(root, 'tools/gh-projections'), {recursive: true})
  const launcher = path.join(root, 'tools/gh-projections/gh-projections')
  await copyFile(source, launcher)
  await chmod(launcher, 0o755)
  return {root, launcher}
}
const run = (launcher, args = [], options = {}) =>
  spawnSync(launcher, args, {
    encoding: 'utf8',
    env: {PATH: process.env.PATH},
    // Only a backstop for a hung launcher: a loaded machine can take seconds to start a process.
    timeout: 60_000,
    ...options,
  })

test('source launcher requires a built native executable, not Node', async t => {
  const {root, launcher} = await fixture(t)
  const tools = path.join(root, 'path-tools')
  await mkdir(tools)
  for (const name of ['dirname', 'readlink']) await symlink(`/usr/bin/${name}`, path.join(tools, name))
  const missing = run(launcher, [], {env: {PATH: tools}})
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /built native CLI is missing/)
  assert.doesNotMatch(missing.stderr, /Node.*required/)
  const unbuilt = run(launcher)
  assert.equal(unbuilt.status, 1)
  assert.match(unbuilt.stderr, /built native CLI is missing/)
  assert.match(unbuilt.stderr, /npm ci\n {2}npm run build/)
})

test('source launcher resolves relative symlinks and execs the selected CLI with caller cwd/argv/exit intact', async t => {
  const {root, launcher} = await fixture(t)
  const dist = path.join(root, 'packages/cli/dist')
  const cwd = path.join(root, 'caller')
  const links = path.join(root, 'links')
  for (const directory of [dist, cwd, links]) await mkdir(directory, {recursive: true})
  await writeFile(path.join(dist, 'projections'), '#!/bin/sh\nprintf \'%s\\0\' "$PWD" "$@"\nexit 23\n', {mode: 0o755})
  await symlink('../tools/gh-projections/gh-projections', path.join(links, 'entry'))
  await symlink('entry', path.join(links, 'second'))
  const args = ['-C', '.', 'show', 'literal $(touch never-created)', '--output', 'path with spaces.json', '']
  const result = run(path.join(links, 'second'), args, {cwd})
  assert.equal(result.status, 23)
  assert.equal(result.stderr, '')
  assert.deepEqual(result.stdout.split('\0'), [cwd, ...args, ''])
  assert.equal(run(launcher, ['--help'], {cwd}).status, 23)
})
