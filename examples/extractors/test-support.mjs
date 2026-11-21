// Runs a sample the way the CLI runs a custom extractor: one request on stdin,
// one extraction on stdout, and the extraction validated by the real Engine.
import {spawnSync} from 'node:child_process'
import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createNativeEngine} from '@githubnext/projections-engine/native'

const here = path.dirname(fileURLToPath(import.meta.url))
const engine = createNativeEngine()

/** What the runner preloads into an extractor run with `node`: `@githubnext/projections/extractor`, with nothing installed. */
const preload = path.join(here, '../../packages/cli/node/register.cjs')

/** A working checkout with `typescript` installed: this workspace. */
export const checkout = here

export const fixture = (sample, name) => path.join(here, sample, 'test/fixtures', name)
export const cases = sample => JSON.parse(readFileSync(path.join(here, sample, 'test/cases.json'), 'utf8'))

/**
 * Runs `sample` against `root` with `repository.checkout` set to `options.checkout`
 * (omitted when null, as for an untrusted extractor); resolves to the normalized
 * extraction or rejects with stderr. NODE_PATH is never set.
 */
export async function run(sample, root, inputs = {}, options = {}) {
  const repository = {root, revision: {kind: 'working-tree', ref: 'WORKTREE', commit: 'fixture', dirty: false}}
  const selected = options.checkout === undefined ? checkout : options.checkout
  if (selected !== null) repository.checkout = selected
  const request = {
    protocolVersion: 0,
    projection: {
      id: sample,
      definition: {id: sample, extractor: {command: ['node', `${sample}/extract.mjs`]}, renderer: 'architecture', inputs},
    },
    repository,
    capabilities: {trusted: selected !== null, network: false},
  }
  const result = spawnSync(process.execPath, ['--require', preload, path.join(here, sample, 'extract.mjs')], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    env: {PATH: process.env.PATH},
  })
  if (result.status !== 0) throw new Error(result.stderr.trim() || `exit ${result.status}`)
  const extraction = JSON.parse(result.stdout)
  await engine.normalize(extraction)
  return extraction
}

export const canonical = async extraction => (await engine.canonicalize(extraction)).canonical
export const compare = (before, after) => engine.compare(before, after)

/** The extraction the sample's former built-in produced for this fixture, ignoring evidence. */
export function expected(sample, name) {
  const value = JSON.parse(readFileSync(`${fixture(sample, name)}.expected.json`, 'utf8'))
  return {protocolVersion: 0, schema: 'architecture/v0', ...value}
}

/** A copy of a fixture outside this workspace. */
export async function isolated(sample, name, action) {
  const root = mkdtempSync(path.join(tmpdir(), 'projections-sample-'))
  try {
    cpSync(fixture(sample, name), root, {recursive: true})
    return await action(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}
