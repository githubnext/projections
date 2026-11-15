// Regenerates the dependency graph fixtures from the npm workspaces beside this script:
// three revisions of one workspace, `npm-workspace/v1` to `v3` (manifests and lockfiles
// written by npm 11), are committed to a scratch Git repository, and the
// workspace-dependencies extractor reads each with the Projections CLI into
// `npm-workspace-<revision>.json`. v1 to v2 moves the API to Express 5 and the web app to
// React 19; v2 to v3 is a small follow-up (React 19.2 and clsx in the web app).
//
//   node renderers/graph/fixtures/make-dependencies.mjs [path/to/projections]
//
// Without a path the debug CLI is built with Cargo. The lockfiles keep registry.npmjs.org
// URLs; regenerate them with `npm install --package-lock-only --ignore-scripts` and
// `node scripts/lockfile-registry.mjs --fix`.
import {execFileSync} from 'node:child_process'
import {cpSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../../..')
let cli = process.argv[2] && path.resolve(process.argv[2])
if (!cli) {
  execFileSync('cargo', ['build', '-q', '-p', 'projections-cli'], {cwd: workspace, stdio: 'inherit'})
  cli = path.join(workspace, 'target/debug/projections')
}
const repository = mkdtempSync(path.join(tmpdir(), 'projections-dependency-fixtures-'))
const git = (...args) =>
  execFileSync('git', ['-c', 'user.name=Fixtures', '-c', 'user.email=fixtures@example.com', ...args], {cwd: repository})
try {
  git('init', '-q')
  const revisions = ['v1', 'v2', 'v3']
  for (const revision of revisions) {
    git('rm', '-rq', '--ignore-unmatch', '.')
    cpSync(path.join(here, 'npm-workspace', revision), repository, {recursive: true})
    git('add', '-A')
    git('commit', '-qm', revision)
  }
  for (const [index, revision] of revisions.entries()) {
    const commit = `HEAD~${revisions.length - 1 - index}`
    const saved = JSON.parse(execFileSync(cli, ['show', commit, '-p', 'workspace-dependencies', '--json'], {cwd: repository, encoding: 'utf8'}))
    writeFileSync(path.join(here, `npm-workspace-${revision}.json`), `${JSON.stringify(saved.extraction, null, 2)}\n`)
  }
} finally {
  rmSync(repository, {recursive: true, force: true})
}
