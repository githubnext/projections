// Shared by the starter renderer specs: one scaffolded, installed and built
// renderer per worker, and its development server.
import {execFileSync, spawn} from 'node:child_process'
import {existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'

// `projections init --renderer custom` scaffolds the renderer package every
// custom renderer starts from. Built the way an author builds it (npm install,
// npm run build), it must pass the checks every built-in renderer is held to.
// It installs @githubnext/projections from this workspace's npm pack tarball
// (build it first: npm run build), as a renderer built from a submodule does.
const cli = process.env.PROJECTIONS_CLI!
const workspace = resolve(import.meta.dirname, '../../..')
const packages = mkdtempSync(join(tmpdir(), 'projections-packages-'))
// The npm that runs these tests, so they work whatever is on PATH.
const npmCli = process.env.npm_execpath
const npm = (args: string[], cwd: string, env = process.env) =>
  npmCli
    ? execFileSync(process.execPath, [npmCli, ...args], {cwd, env, stdio: 'pipe'})
    : execFileSync('npm', args, {cwd, env, stdio: 'pipe'})
// The scaffold installs outside the workspace, with the workspace's registry (the committed .npmrc, or CI's
// npm_config_registry) rather than npm's default. npm retries a request that fails on the network or with a 5xx, never
// a missing version; a few more times here.
const registry = {
  ...process.env,
  npm_config_registry: npm(['config', 'get', 'registry'], workspace).toString().trim(),
  npm_config_fetch_retries: process.env.npm_config_fetch_retries ?? '5',
}
npm(['pack', '--workspace', 'packages/sdk', '--pack-destination', packages], workspace)
// The long path: Vite's development server refuses a Windows 8.3 short name (RUNNER~1 in a runner's temporary
// directory).
export const repository = realpathSync.native(mkdtempSync(join(tmpdir(), 'projections-starter-')))
execFileSync('git', ['init', '-q'], {cwd: repository})
execFileSync(cli, ['init', 'service-map', '--language', 'node', '--renderer', 'custom'], {
  cwd: repository,
  env: {...process.env, PROJECTIONS_RENDERER_PACKAGES: packages},
})
export const renderer = join(repository, '.github/projections/service-map/renderer')
// With the versions this workspace's lockfile installed rather than whatever the registry newly lists for the
// scaffold's ranges (a release its mirror hasn't caught up with fails the install: `ETARGET No matching version`).
const scaffold = JSON.parse(readFileSync(join(renderer, 'package.json'), 'utf8')) as Partial<
  Record<'dependencies' | 'devDependencies', Record<string, string>>
>
for (const field of ['dependencies', 'devDependencies'] as const) {
  const ranges = scaffold[field] ?? {}
  for (const [name, range] of Object.entries(ranges)) {
    const installed = join(workspace, 'node_modules', name, 'package.json')
    if (!/^[\^~]?\d/u.test(range) || !existsSync(installed)) continue
    const {version} = JSON.parse(readFileSync(installed, 'utf8')) as {version: string}
    if (version.split('.')[0] !== range.replace(/^[\^~]/u, '').split('.')[0]) {
      throw new Error(`The scaffold asks for ${name}@${range}, but this workspace installs ${version}`)
    }
    ranges[name] = version
  }
}
writeFileSync(join(renderer, 'package.json'), `${JSON.stringify(scaffold, null, 2)}\n`)
npm(['install', '--no-audit', '--no-fund'], renderer, registry)
npm(['run', 'build'], renderer)

// `npm run dev`: Vite's development server, which the Inspector prefers while it runs.
const vite = spawn(process.execPath, [join(renderer, 'node_modules/vite/bin/vite.js'), '--port', '0'], {cwd: renderer, stdio: 'ignore'})
process.once('exit', () => {
  vite.kill()
})
export const record = join(renderer, 'node_modules/.projections/renderer-dev-server.json')
for (let waited = 0; !existsSync(record); waited += 100) {
  if (waited > 30_000) throw new Error('The renderer development server did not start')
  await new Promise(done => {
    setTimeout(done, 100)
  })
}
