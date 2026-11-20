// The state-machine checks (docs/guides/state-machines.md), as `path:line: message` problems:
// - the lifecycle rule (check-machines/lifecycle-rule.mjs) finds no more in a file than check-machines/baseline.json
//   allows: existing implicit lifecycles are converted over time, and no new ones are added. A file with fewer than its
//   baseline fails too, until `--update` lowers it, so the baseline only ever shrinks.
// - every machine (`defineMachine`) is exported, and its workspace's tests explore it (`explore(` naming it).
// Usage: node tools/scripts/check-machines.mjs [--update]
import {readFile, readdir, writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname, join, relative, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {ESLint} from 'eslint'
import {lifecycleFiles} from './check-machines/lifecycle-rule.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const baselinePath = join(root, 'tools/scripts/check-machines/baseline.json')
const update = process.argv.includes('--update')
const posix = path => path.split(sep).join('/')
const problems = []

// The lifecycle rule against the baseline.
const eslint = new ESLint({cwd: root, ruleFilter: ({ruleId}) => ruleId === 'machines/lifecycle'})
const counts = {}
const first = {}
for (const result of await eslint.lintFiles(lifecycleFiles)) {
  const found = result.messages.filter(message => message.ruleId === 'machines/lifecycle')
  if (!found.length) continue
  const path = posix(relative(root, result.filePath))
  counts[path] = found.length
  first[path] = found
}
const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)))
if (update) {
  await writeFile(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`)
  console.log(
    `Wrote ${posix(relative(root, baselinePath))}: ${Object.values(sorted).reduce((sum, count) => sum + count, 0)} in ${Object.keys(sorted).length} files`,
  )
}
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
for (const path of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
  const count = counts[path] ?? 0
  const allowed = baseline[path] ?? 0
  if (count > allowed)
    for (const message of first[path].slice(allowed)) problems.push(`${path}:${message.line}: ${message.message} (machines/lifecycle)`)
  else if (count < allowed)
    problems.push(
      `${path}: has ${count} implicit lifecycle patterns, fewer than the baseline's ${allowed}; lower it with node tools/scripts/check-machines.mjs --update`,
    )
}

// Every machine is exported and explored by its workspace's tests.
async function files(directory, match) {
  if (!existsSync(directory)) return []
  const found = []
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (['node_modules', 'dist', 'fixtures'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await files(path, match)))
    else if (match.test(entry.name)) found.push(path)
  }
  return found
}
const workspaceOf = path => {
  for (let directory = dirname(path); directory.startsWith(root); directory = dirname(directory))
    if (existsSync(join(directory, 'package.json'))) return directory
  return root
}
const tests = new Map()
const testsOf = async workspace => {
  if (!tests.has(workspace))
    tests.set(
      workspace,
      await Promise.all((await files(join(workspace, 'test'), /\.(test\.[cm]?[jt]sx?|[cm]?ts)$/)).map(path => readFile(path, 'utf8'))),
    )
  return tests.get(workspace)
}
const definition = /\b(export\s+)?const\s+(\w+)\s*=\s*defineMachine\s*</g
for (const path of await files(join(root, 'packages'), /\.tsx?$/)) {
  if (posix(relative(root, path)).startsWith('packages/machine/')) continue
  const text = await readFile(path, 'utf8')
  if (!text.includes('defineMachine')) continue
  const at = index => text.slice(0, index).split('\n').length
  const named = [...text.matchAll(definition)]
  if (named.length !== text.match(/\bdefineMachine\s*</g)?.length)
    problems.push(
      `${posix(relative(root, path))}:${at(text.indexOf('defineMachine'))}: bind each machine to an exported const, so its explore test can import it`,
    )
  for (const match of named) {
    const line = `${posix(relative(root, path))}:${at(match.index)}`
    if (!match[1]) problems.push(`${line}: export ${match[2]}, so its explore test can import it`)
    const workspace = workspaceOf(path)
    const explored = (await testsOf(workspace)).some(test => test.includes('explore(') && new RegExp(`\\b${match[2]}\\b`).test(test))
    if (!explored)
      problems.push(
        `${line}: ${match[2]} has no explore test in ${posix(relative(root, join(workspace, 'test')))} (docs/guides/state-machines.md#test-it)`,
      )
  }
}

for (const problem of problems) console.log(problem)
if (problems.length) process.exitCode = 1
