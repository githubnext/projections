import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {canonical, cases, expected, fixture, isolated, run} from '../../test-support.mjs'

test('reproduces the former built-in feature-flags extractor', async () => {
  for (const {name, inputs} of cases('feature-flags')) {
    assert.equal(
      await canonical(await run('feature-flags', fixture('feature-flags', name), inputs)),
      await canonical(expected('feature-flags', name)),
      name,
    )
  }
})

test('resolves configured APIs, static keys and package ownership, and warns on dynamic keys', async () => {
  const state = await run('feature-flags', fixture('feature-flags', 'flags'), cases('feature-flags')[0].inputs)
  assert.deepEqual(
    state.entities.filter(node => node.kind === 'flag').map(node => node.label),
    ['checkout'],
  )
  assert.ok(state.entities.some(node => node.kind === 'package' && node.label === 'shop'))
  assert.ok(state.relationships.some(edge => edge.kind === 'checks'))
  assert.match(JSON.stringify(state.metadata), /dynamic flag key/u)
  assert.ok(state.entities.every(node => node.evidence?.every(item => !path.isAbsolute(item.source))))
})

test('repeated occurrences keep a bounded evidence sample', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'projections-flags-'))
  try {
    writeFileSync(path.join(root, 'package.json'), '{"name":"@example/app"}')
    writeFileSync(path.join(root, 'flags.d.ts'), 'declare module "flags" { export function enabled(key: string): boolean; }')
    writeFileSync(
      path.join(root, 'index.ts'),
      `import { enabled } from "flags";\n${Array.from({length: 40}, (_, index) => `export function check${index}() { return enabled("checkout"); }`).join('\n')}`,
    )
    const state = await run('feature-flags', root, {flagApis: [{module: 'flags', symbol: 'enabled'}]})
    const flag = state.entities.find(node => node.kind === 'flag')
    assert.equal(flag.evidence.length, 25)
    assert.equal(flag.evidence[0].location.line, 2)
    assert.equal(state.entities.filter(node => node.kind === 'consumer').length, 40)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('missing conventions, invalid arguments and a missing compiler fail explicitly', async () => {
  await assert.rejects(run('feature-flags', fixture('feature-flags', 'flags')), /flagApis is required/u)
  await assert.rejects(run('feature-flags', fixture('feature-flags', 'flags'), {flagApis: [{}]}), /requires nonempty module/u)
  await assert.rejects(
    run('feature-flags', fixture('feature-flags', 'flags'), {...cases('feature-flags')[0].inputs, flagArgument: -1}),
    /nonnegative integer/u,
  )
  // TypeScript comes from the working checkout, never from the examined revision or NODE_PATH.
  await isolated('feature-flags', 'flags', root =>
    assert.rejects(
      run('feature-flags', root, cases('feature-flags')[0].inputs, {checkout: root}),
      /not installed in your working checkout/u,
    ),
  )
  await assert.rejects(
    run('feature-flags', fixture('feature-flags', 'flags'), cases('feature-flags')[0].inputs, {checkout: null}),
    /only to trusted extractors/u,
  )
})
