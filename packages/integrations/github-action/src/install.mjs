// Installs the Projections CLI for the runner: a verified release asset, or a source build.
import {spawnSync} from 'node:child_process'
import {appendFileSync, chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync} from 'node:fs'
import path from 'node:path'
import {sha256} from './lib.mjs'
import {expectedDigest, isMajorTag, newestInMajor, releaseAsset, releaseTag} from './release.mjs'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options})
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed with exit status ${result.status}`)
  return result
}
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

const temporary = process.env.RUNNER_TEMP
if (!temporary) throw new Error('RUNNER_TEMP is not set; run this inside GitHub Actions')
const directory = path.join(temporary, 'projections-cli')
rmSync(directory, {recursive: true, force: true})
mkdirSync(path.join(directory, 'bin'), {recursive: true})
const windows = process.env.RUNNER_OS === 'Windows'
const installed = path.join(directory, 'bin', windows ? 'projections.exe' : 'projections')

if (process.env.INPUT_BUILD_FROM_SOURCE === 'true') {
  // The action's own checkout is the public workspace. Nothing from the examined repository is built.
  const root = process.env.GITHUB_ACTION_PATH
  if (!root) throw new Error('GITHUB_ACTION_PATH is not set')
  console.log('Building the Projections CLI from the action source (build-from-source: true)')
  run(process.execPath, ['packages/comparators/default/scripts/build.mjs'], {cwd: root})
  run('cargo', ['build', '--locked', '--release', '-p', 'projections-cli'], {cwd: root})
  copyFileSync(path.join(root, 'target', 'release', windows ? 'projections.exe' : 'projections'), installed)
} else {
  const repository = process.env.INPUT_CLI_REPOSITORY || 'githubnext/projections'
  if (!/^[A-Za-z0-9-]+\/[\w.-]+$/u.test(repository)) throw new Error(`cli-repository must be owner/name, not ${repository}`)
  const asset = releaseAsset(process.env.RUNNER_OS, process.env.RUNNER_ARCH)
  let tag = releaseTag(process.env.INPUT_VERSION, process.env.ACTION_REF)
  if (isMajorTag(tag)) {
    // @v0 installs v0's newest stable release, never a later major's.
    const listed = run('gh', ['release', 'list', '--repo', repository, '--limit', '1000', '--json', 'tagName,isDraft,isPrerelease'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
    })
    const major = tag
    tag = newestInMajor(JSON.parse(listed.stdout), major)
    console.log(`${major} is ${tag}`)
  }
  console.log(`Downloading ${asset} from ${repository} ${tag ?? 'latest release'}`)
  run('gh', [
    'release',
    'download',
    ...(tag ? [tag] : []),
    '--repo',
    repository,
    '--pattern',
    asset,
    '--pattern',
    `${asset}.sha256`,
    '--dir',
    directory,
    '--clobber',
  ])
  const file = path.join(directory, asset)
  const actual = sha256(readFileSync(file))
  const expected = expectedDigest(readFileSync(`${file}.sha256`, 'utf8'), asset)
  if (actual !== expected) throw new Error(`${asset} has SHA-256 ${actual}, but ${asset}.sha256 lists ${expected}`)
  // Build provenance: the asset was built by this repository's release workflow.
  run('gh', ['attestation', 'verify', file, '--repo', repository])
  copyFileSync(file, installed)
}
if (!windows) chmodSync(installed, 0o755)
const version = spawnSync(installed, ['--version'], {encoding: 'utf8'})
if (version.status !== 0) throw new Error('The installed CLI did not run')
console.log(version.stdout.trim())
output('cli-path', installed)
output('cli-version', version.stdout.trim())
