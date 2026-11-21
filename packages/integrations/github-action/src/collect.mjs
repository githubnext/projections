// Runs the Projections CLI for this workflow's pull_request or push event and
// writes the artifact directory: one document per projection and the manifest.
import {spawnSync} from 'node:child_process'
import {appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {artifactManifest, cliArguments, eventSubject, splitBatch} from './lib.mjs'

const environment = process.env
const output = (name, value) => {
  if (environment.GITHUB_OUTPUT) appendFileSync(environment.GITHUB_OUTPUT, `${name}=${value}\n`)
}
const repo = path.resolve(environment.INPUT_WORKING_DIRECTORY || '.')
const temporary = environment.RUNNER_TEMP
const cli = environment.PROJECTIONS_CLI
if (!temporary || !cli) throw new Error('RUNNER_TEMP and PROJECTIONS_CLI must be set')

function git(args) {
  const result = spawnSync('git', args, {cwd: repo, encoding: 'utf8'})
  if (result.error) throw result.error
  return result
}
function requireCommit(sha) {
  if (git(['cat-file', '-e', `${sha}^{commit}`]).status === 0) return
  // A shallow checkout may lack the commit; fetching it needs the checkout's credentials.
  git(['fetch', '--no-tags', '--quiet', 'origin', sha])
  if (git(['cat-file', '-e', `${sha}^{commit}`]).status !== 0) {
    throw new Error(`Commit ${sha} is not in the checkout. Check out with fetch-depth: 0 before this action.`)
  }
}

// Testing the Action itself: another event for a repository other than the workflow's.
const test = environment.PROJECTIONS_TEST_EVENT_PATH
const event = JSON.parse(readFileSync(test || environment.GITHUB_EVENT_PATH, 'utf8'))
const subject = eventSubject(
  test ? environment.PROJECTIONS_TEST_EVENT_NAME : environment.GITHUB_EVENT_NAME,
  event,
  test ? environment.PROJECTIONS_TEST_REF : environment.GITHUB_REF,
)
if (subject.kind === 'pull-request') {
  requireCommit(subject.base)
  requireCommit(subject.head)
  const mergeBase = git(['merge-base', subject.base, subject.head])
  if (mergeBase.status !== 0) throw new Error('The pull request base and head have no merge base')
  subject.mergeBase = mergeBase.stdout.trim()
} else requireCommit(subject.revision)

const trust = environment.INPUT_TRUST === 'true'
const work = path.join(temporary, 'projections-run')
rmSync(work, {recursive: true, force: true})
mkdirSync(work, {recursive: true})
const batchPath = path.join(work, 'batch.json')
// The merge base's own artifact, which the base step downloaded, if there is one.
const base = environment.PROJECTIONS_BASE_ARTIFACT
const artifacts = base && existsSync(path.join(base, artifactManifest)) ? [base] : []
const args = ['-C', repo, ...cliArguments(subject, {trust, output: batchPath, artifacts})]
console.log(`projections ${args.join(' ')}`)
const result = spawnSync(cli, args, {cwd: repo, stdio: 'inherit'})
if (result.error) throw result.error
// The CLI writes the complete batch, then exits unsuccessfully if any projection failed.
if (!existsSync(batchPath)) throw new Error(`The Projections CLI failed with exit status ${result.status} before producing a result`)

const [owner, name] = (environment.GITHUB_REPOSITORY ?? '').split('/')
const version = spawnSync(cli, ['--version'], {encoding: 'utf8'}).stdout?.trim() || 'unknown'
const {manifest, files} = splitBatch(JSON.parse(readFileSync(batchPath, 'utf8')), {
  subject,
  trust,
  cli: version,
  action: environment.ACTION_REPOSITORY ? `${environment.ACTION_REPOSITORY}@${environment.ACTION_REF}` : undefined,
  repository: {id: Number(environment.GITHUB_REPOSITORY_ID), owner, name},
  run: {id: Number(environment.GITHUB_RUN_ID), attempt: Number(environment.GITHUB_RUN_ATTEMPT)},
})
const directory = path.join(temporary, 'projections-artifact')
rmSync(directory, {recursive: true, force: true})
for (const [file, bytes] of files) {
  mkdirSync(path.dirname(path.join(directory, file)), {recursive: true})
  writeFileSync(path.join(directory, file), bytes)
}
const failed = manifest.projections.filter(projection => projection.status === 'error')
for (const projection of failed) {
  for (const diagnostic of projection.diagnostics) {
    console.log(`::error title=Projection ${projection.id}::${diagnostic.code}: ${diagnostic.message.replace(/\r?\n/g, ' ')}`)
  }
}
output('directory', directory)
output('manifest', path.join(directory, artifactManifest))
output('projections', manifest.projections.length)
output('failed', failed.length)
output('pull-request', subject.kind === 'pull-request' ? subject.number : '')
