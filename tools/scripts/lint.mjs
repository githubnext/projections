// npm run lint: ESLint over the repository one workspace at a time. Type-aware rules load a TypeScript program for
// each tsconfig they meet and keep it, so one process over everything holds every workspace's program at once (more
// than Node's default heap); a process per workspace holds one workspace's. Files outside every workspace (tools/scripts,
// the self-projection) are one more group. Arguments pass through to ESLint, such as --fix or --quiet. Two groups run at
// once in CI and one locally, where memory is shared with everything else; --jobs <n> overrides it. TIMING passes
// through too, so `TIMING=10 npm run lint` reports each group's slowest rules.
import {spawn} from 'node:child_process'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const eslint = join(root, 'node_modules/eslint/bin/eslint.js')
const options = process.argv.slice(2)
const jobsAt = options.indexOf('--jobs')
const jobs = jobsAt === -1 ? (process.env.CI ? 2 : 1) : Number(options[jobsAt + 1])
if (!Number.isInteger(jobs) || jobs < 1) throw new Error('Expected --jobs <a positive whole number>')
const passed = jobsAt === -1 ? options : options.toSpliced(jobsAt, 2)

// Workspace entries are literal directories or a single trailing `/*` level, as in tools/scripts/workspaces.mjs.
const workspaces = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  .workspaces.flatMap(pattern => {
    if (!pattern.endsWith('/*')) return [pattern]
    const parent = join(root, pattern.slice(0, -2))
    return readdirSync(parent, {withFileTypes: true})
      .filter(entry => entry.isDirectory())
      .map(entry => `${pattern.slice(0, -2)}/${entry.name}`)
  })
  .filter(directory => existsSync(join(root, directory, 'package.json')))
const groups = [
  ...workspaces.map(directory => ({name: directory, args: [directory]})),
  {name: 'everything else', args: ['.', ...workspaces.flatMap(directory => ['--ignore-pattern', `${directory}/**`])]},
]

function lint(group) {
  const started = performance.now()
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [eslint, ...group.args, ...passed], {cwd: root, stdio: ['ignore', 'pipe', 'pipe']})
    let output = ''
    child.stdout.on('data', chunk => (output += chunk))
    child.stderr.on('data', chunk => (output += chunk))
    child.once('error', failed)
    child.once('close', code => done({...group, code, output, seconds: (performance.now() - started) / 1000}))
  })
}

const pending = [...groups]
const results = []
async function worker() {
  for (let group = pending.shift(); group; group = pending.shift()) {
    const result = await lint(group)
    results.push(result)
    const status = result.code === 0 ? 'pass' : 'fail'
    process.stdout.write(`${status} ${result.name} (${result.seconds.toFixed(1)}s)\n${result.output}`)
  }
}
await Promise.all(Array.from({length: Math.min(jobs, groups.length)}, worker))
const failures = results.filter(result => result.code !== 0)
if (failures.length) {
  process.stderr.write(`ESLint failed in ${failures.map(result => result.name).join(', ')}\n`)
  process.exitCode = 1
}
