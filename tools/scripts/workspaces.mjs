import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [task, ...options] = process.argv.slice(2)
if (!['build', 'test', 'test:browser', 'typecheck'].includes(task)) throw new Error('Expected build, test, test:browser or typecheck')
// `--except <directories>` (comma- or space-separated, relative to the root) leaves out workspaces that run elsewhere,
// such as the browser suites CI shards across jobs. Dependency order is unchanged.
if (options.length && (options.length !== 2 || options[0] !== '--except')) throw new Error('Expected only --except <directories>')
const except = new Set(
  (options[1] ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(directory => resolve(root, directory)),
)
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run workspace tasks through npm run build, test or typecheck')
// Workspace entries are literal directories or a single trailing `/*` level.
const directories = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).workspaces.flatMap(pattern => {
  if (!pattern.endsWith('/*')) return [resolve(root, pattern)]
  const parent = resolve(root, pattern.slice(0, -2))
  return existsSync(parent)
    ? readdirSync(parent, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => resolve(parent, entry.name))
    : []
})
const packages = new Map()
const unknown = [...except].filter(directory => !directories.includes(directory))
if (unknown.length) throw new Error(`Not workspaces: ${unknown.join(', ')}`)
for (const directory of directories) {
  const path = resolve(directory, 'package.json')
  if (!existsSync(path)) continue
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (packages.has(manifest.name)) throw new Error(`Duplicate workspace ${manifest.name}`)
  packages.set(manifest.name, {...manifest, directory})
}
const done = new Set()
const visiting = new Set()
function run(name) {
  if (done.has(name)) return
  if (visiting.has(name)) throw new Error(`Workspace dependency cycle at ${name}`)
  visiting.add(name)
  const manifest = packages.get(name)
  for (const dependency of Object.keys({...manifest.dependencies, ...manifest.devDependencies}).sort()) {
    if (packages.has(dependency)) run(dependency)
  }
  if (manifest.scripts?.[task] && !except.has(manifest.directory)) {
    execFileSync(process.execPath, [npm, 'run', task, '--workspace', name], {cwd: root, stdio: 'inherit'})
  }
  visiting.delete(name)
  done.add(name)
}
for (const name of [...packages.keys()].sort()) run(name)
