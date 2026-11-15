import {spawn} from 'node:child_process'
import {cp, mkdir, readFile, rm} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createNativeEngine} from '@githubnext/projections-engine/native'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
export const helper = path.join(packageRoot, 'dist/extractor.mjs')
const require = createRequire(import.meta.url)
const engine = createNativeEngine()

/**
 * Installs the workspace's lockfile-pinned `typescript` into a repository checkout,
 * as the project's own package manager would.
 */
export async function installToolchain(checkout) {
  await mkdir(path.join(checkout, 'node_modules'), {recursive: true})
  const source = path.dirname(require.resolve('typescript/package.json'))
  await cp(source, path.join(checkout, 'node_modules/typescript'), {recursive: true})
  return checkout
}

// Test files run in separate processes, so each process installs its own checkout.
const sharedCheckout = path.join(packageRoot, `test/fixtures/.toolchain-${process.pid}`)
let prepared
/** One repository checkout with the project's packages installed, shared by every test in a run. */
export function toolchain() {
  prepared ??= (async () => {
    await rm(sharedCheckout, {recursive: true, force: true})
    await installToolchain(sharedCheckout)
    process.once('exit', () => import('node:fs').then(fs => fs.rmSync(sharedCheckout, {recursive: true, force: true})))
    return sharedCheckout
  })()
  return prepared
}

/** Runs the bundled helper as the native CLI does: request on stdin, extraction on stdout. */
export async function runHelper(id, input, checkout, {node = process.execPath, args = []} = {}) {
  const child = spawn(node, [...args, helper, id, checkout], {stdio: ['pipe', 'pipe', 'pipe']})
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk
  })
  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr += chunk
  })
  child.stdin.end(JSON.stringify(input))
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  return {status, stdout, stderr}
}

const collect = async context => {
  const checkout = context.checkout ?? (await toolchain())
  const input = context.input
  const {definition} = input.projection
  const result = await runHelper(definition.extractor, input, checkout)
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Helper exited with ${result.status}`)
  const extraction = JSON.parse(result.stdout)
  await engine.normalize(extraction)
  return extraction
}
export const collectTypeScript = collect
export const canonicalize = async extraction => (await engine.canonicalize(extraction)).canonical
/** Runs the default comparator; `changed` is true when any change is reported. */
export const compareExtractions = async (before, after) => {
  const comparison = await engine.compare(before, after)
  return {...comparison, changed: comparison.changes.length > 0}
}
/** Labels of after-side entities the comparison reports as modified. */
export const modifiedLabels = (comparison, after) =>
  new Set(
    comparison.changes
      .filter(change => change.collection === 'entities' && change.status === 'modified')
      .flatMap(change => change.after.map(id => after.entities.find(entity => entity.id === id)?.label)),
  )

/**
 * Installs workspace packages and their runtime dependency closure into a checkout's
 * flat `node_modules`, as the project's own package manager would, so nothing
 * resolves from the workspace above the checkout.
 */
export async function installPackages(checkout, names) {
  const pending = names.map(name => [name, packageRoot])
  const installed = new Set()
  while (pending.length) {
    const [name, from] = pending.shift()
    if (installed.has(name)) continue
    installed.add(name)
    // Not every package exports its manifest, so it is found the way Node walks `node_modules`.
    const manifest = createRequire(path.join(from, 'package.json'))
      .resolve.paths(name)
      .map(directory => path.join(directory, name, 'package.json'))
      .find(file => existsSync(file))
    if (!manifest) throw new Error(`${name} is not installed in the workspace`)
    const source = path.dirname(manifest)
    await cp(source, path.join(checkout, 'node_modules', name), {recursive: true, dereference: true})
    const {dependencies = {}} = JSON.parse(await readFile(manifest, 'utf8'))
    for (const dependency of Object.keys(dependencies)) pending.push([dependency, source])
  }
  return checkout
}
