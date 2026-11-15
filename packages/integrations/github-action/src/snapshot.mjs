// Renders the projections the `snapshots` input lists as PNGs, light and dark,
// from the documents collect.mjs saved: both sides of a pull request's
// comparison, or a push's extraction. No extractor runs again, and no token is
// available to this step; renderers run sandboxed in the runner's own Chrome.
import {spawnSync} from 'node:child_process'
import {appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {sha256, snapshotIds, snapshotIndex, snapshotName, snapshotPlan, snapshotThemes} from './lib.mjs'

const environment = process.env
const output = (name, value) => {
  if (environment.GITHUB_OUTPUT) appendFileSync(environment.GITHUB_OUTPUT, `${name}=${value}\n`)
}
const temporary = environment.RUNNER_TEMP
const cli = environment.PROJECTIONS_CLI
const manifestPath = environment.PROJECTIONS_MANIFEST
if (!temporary || !cli || !manifestPath) throw new Error('RUNNER_TEMP, PROJECTIONS_CLI and PROJECTIONS_MANIFEST must be set')
const repo = path.resolve(environment.INPUT_WORKING_DIRECTORY || '.')
const artifact = path.dirname(manifestPath)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const ids = snapshotIds(environment.INPUT_SNAPSHOTS)

const directory = path.join(temporary, 'projections-snapshots')
rmSync(directory, {recursive: true, force: true})
mkdirSync(directory, {recursive: true})
const {renders, skipped} = snapshotPlan(manifest, ids)
for (const {id, reason} of skipped) console.log(`::warning title=Projection snapshot ${id}::No snapshot: ${reason}`)

const snapshots = []
const failed = []
for (const render of renders) {
  const document = path.join(artifact, render.path)
  for (const theme of snapshotThemes) {
    const name = snapshotName(render.id, render.side, theme)
    const args = ['-C', repo, 'show', '--from', document, '--png', path.join(directory, name), '--theme', theme]
    // One side of the comparison, drawn by the renderer of the definition that explained it (the base's, as collected).
    if (render.part) args.push('--side', render.part)
    if (environment.INPUT_TRUST === 'true') args.push('--trust')
    console.log(`projections ${args.join(' ')}`)
    const result = spawnSync(cli, args, {
      cwd: repo,
      encoding: 'utf8',
      env: {...environment, ...(environment.INPUT_BROWSER ? {PROJECTIONS_BROWSER: environment.INPUT_BROWSER} : {})},
    })
    if (result.error) throw result.error
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.status !== 0) {
      // The error's own line; a hint or the extractor's stderr may follow it.
      const lines = (result.stderr || `exit status ${result.status}`).trim().split(/\r?\n/)
      const message = (lines.findLast(line => /^projections: (?!note: )/.test(line)) ?? lines.at(-1)).replace(/^projections: /, '')
      console.log(`::warning title=Projection snapshot ${render.id}::${message}`)
      failed.push({id: render.id, ...(render.side ? {side: render.side} : {}), theme, message})
      continue
    }
    snapshots.push({
      id: render.id,
      ...(render.side ? {side: render.side} : {}),
      theme,
      path: name,
      sha256: sha256(readFileSync(path.join(directory, name))),
    })
  }
}
writeFileSync(
  path.join(directory, snapshotIndex),
  `${JSON.stringify({format: 'projections.snapshots', version: 0, subject: manifest.subject, snapshots, skipped, failed}, null, 2)}\n`,
)
output('directory', directory)
output('count', snapshots.length)
output('failed', failed.length)
