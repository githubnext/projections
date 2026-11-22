// On a pull request, downloads the merge base's own projections artifact (from the newest successful run of this
// workflow file for that commit, for a push or a pull request from this repository, never a fork's), so the CLI
// reuses CI's extractions of the base instead of extracting it again. This step holds the token and runs nothing
// from the repository; the CLI verifies every reused extraction and labels it imported, since it can't
// authenticate the artifact itself. Anything that goes wrong is a warning: the base is then extracted (and
// prepared) as usual.
import {spawnSync} from 'node:child_process'
import {appendFileSync, existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs'
import path from 'node:path'
import {artifactManifest, artifactRuns, eventSubject, workflowPath} from './lib.mjs'

const environment = process.env
const output = (name, value) => {
  if (environment.GITHUB_OUTPUT) appendFileSync(environment.GITHUB_OUTPUT, `${name}=${value}\n`)
}
const repo = path.resolve(environment.INPUT_WORKING_DIRECTORY || '.')
const temporary = environment.RUNNER_TEMP
if (!temporary) throw new Error('RUNNER_TEMP must be set')
const name = environment.INPUT_ARTIFACT_NAME || 'projections'
const repository = environment.GITHUB_REPOSITORY ?? ''

function run(command, args, cwd = repo) {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024})
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(' ')} failed: ${result.stderr.trim()}`)
  return result.stdout
}

try {
  const test = environment.PROJECTIONS_TEST_EVENT_PATH
  const event = JSON.parse(readFileSync(test || environment.GITHUB_EVENT_PATH, 'utf8'))
  const subject = eventSubject(
    test ? environment.PROJECTIONS_TEST_EVENT_NAME : environment.GITHUB_EVENT_NAME,
    event,
    test ? environment.PROJECTIONS_TEST_REF : environment.GITHUB_REF,
  )
  if (subject.kind !== 'pull-request') process.exit(0)
  if (!/^[A-Za-z0-9-]+\/[\w.-]+$/u.test(repository)) throw new Error(`Unexpected repository ${repository}`)
  for (const commit of [subject.base, subject.head]) {
    if (spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], {cwd: repo}).status !== 0) {
      spawnSync('git', ['fetch', '--no-tags', '--quiet', 'origin', commit], {cwd: repo})
    }
  }
  const workflow = workflowPath(environment.GITHUB_WORKFLOW_REF, repository)
  if (!workflow) throw new Error(`Unexpected workflow ${environment.GITHUB_WORKFLOW_REF}`)
  const mergeBase = run('git', ['merge-base', subject.base, subject.head]).trim()
  const runs = artifactRuns(
    JSON.parse(run('gh', ['api', `repos/${repository}/actions/runs?head_sha=${mergeBase}&status=success&per_page=20`])),
    {repository, workflow},
  )
  for (const id of runs) {
    const listed = JSON.parse(run('gh', ['api', `repos/${repository}/actions/runs/${id}/artifacts?name=${encodeURIComponent(name)}`]))
    if (!(listed.artifacts ?? []).some(artifact => artifact.name === name && !artifact.expired)) continue
    const directory = path.join(temporary, 'projections-base')
    rmSync(directory, {recursive: true, force: true})
    mkdirSync(directory, {recursive: true})
    run('gh', ['run', 'download', String(id), '--repo', repository, '--name', name, '--dir', directory])
    if (!existsSync(path.join(directory, artifactManifest))) throw new Error(`Run ${id}'s ${name} artifact has no ${artifactManifest}`)
    console.log(`Reusing the merge base's extractions from run ${id}; the CLI verifies each one`)
    output('directory', directory)
    process.exit(0)
  }
  console.log(
    `No successful run of ${workflow} published a ${name} artifact for the merge base ${mergeBase.slice(0, 7)}; it is extracted here`,
  )
} catch (error) {
  console.log(`::warning title=Projections::The merge base's CI artifact couldn't be reused (${error.message}); it is extracted here`)
}
