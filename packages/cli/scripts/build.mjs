// Builds the self-contained native CLI: one executable that embeds the Inspector and
// static-site client, the renderer bundles, the default comparator, the rules
// interpreter, the extractor helpers, the license and the third-party notices.
//
//   node packages/cli/scripts/build.mjs                    host build into packages/cli/dist/projections
//   node packages/cli/scripts/build.mjs --target TRIPLE    build for TRIPLE (packages/cli/dist/TRIPLE/projections)
//
// Build the workspace first (`npm run build`): the browser client, the default
// comparator module and the TypeScript helper are inputs, never built here.
import {spawnSync} from 'node:child_process'
import {chmod, copyFile, mkdir, rm} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {publishHelper} from '../../extractors/dotnet-support/scripts/publish.mjs'

const {values} = parseArgs({options: {target: {type: 'string'}}})
const root = fileURLToPath(new URL('../../../', import.meta.url))
const cli = path.join(root, 'packages/cli')
function run(command, args, env) {
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit', env})
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with ${result.status}`)
}
// The slim .NET helper is published here (never restored at extraction time) and
// contains no third-party code. Without a .NET 8+ SDK it is omitted with a warning
// unless PROJECTIONS_REQUIRE_HELPERS=1. Releases build with dist instead, embedding
// the helper published once for every platform (see dist-workspace.toml).
publishHelper()
const target = values.target
run('cargo', ['build', '--locked', '--release', '-p', 'projections-cli', ...(target ? ['--target', target] : [])], {
  ...process.env,
  PROJECTIONS_EMBED_HELPERS: '1',
})
const windows = target ? target.includes('-windows-') : process.platform === 'win32'
const executable = `projections${windows ? '.exe' : ''}`
const output = target ? path.join(cli, 'dist', target) : path.join(cli, 'dist')
await mkdir(output, {recursive: true})
// Layouts of earlier builds shipped helpers and notices beside the executable.
for (const stale of ['collectors', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'platform.json']) {
  await rm(path.join(cli, 'dist', stale), {recursive: true, force: true})
}
// Replace rather than overwrite, so an already running executable keeps its own file.
await rm(path.join(output, executable), {force: true})
await copyFile(path.join(root, 'target', ...(target ? [target] : []), 'release', executable), path.join(output, executable))
await chmod(path.join(output, executable), 0o755)
