import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import test from 'node:test'
import {pathToFileURL} from 'node:url'
import {workspaceRoot} from '../src/lib/repo.ts'

// The proofs themselves need Verus (`tools verify`, and the verus CI job); these check what can go stale without it.
const verified = join(workspaceRoot, 'packages/engine/verified')
const script = (name: string) =>
  import(pathToFileURL(join(verified, 'scripts', name)).href) as Promise<Record<string, (...args: unknown[]) => unknown>>

test('Cargo.toml uses the verus_builtin_macros version verus.toml pins', async () => {
  const {consistent, pins} = await script('verify.mjs')
  assert.deepEqual(consistent!(), [])
  assert.match((pins!() as {release: string}).release, /^0\.\d{4}\.\d{2}\.\d{2}\.[0-9a-f]{7}$/u)
})

test('every mutant names a clause and plants a change its module still contains', async () => {
  const mutants = (await (
    await script('mutants.mjs')
  ).mutants!()) as {file: string; name: string; from: string; to: string; clause: string; also?: [string, string][]}[]
  assert.ok(mutants.length > 0)
  const names = new Set<string>()
  for (const mutant of mutants) {
    assert.ok(!names.has(mutant.name), `duplicate mutant ${mutant.name}`)
    names.add(mutant.name)
    const source = readFileSync(join(verified, 'src', mutant.file), 'utf8')
    for (const [from, to] of [[mutant.from, mutant.to], ...(mutant.also ?? [])] as [string, string][]) {
      assert.ok(source.includes(from), `${mutant.name}: src/${mutant.file} no longer contains ${JSON.stringify(from)}`)
      assert.notEqual(from, to, mutant.name)
    }
    assert.ok(source.includes(mutant.clause), `${mutant.name}: no clause ${JSON.stringify(mutant.clause)}`)
  }
})
