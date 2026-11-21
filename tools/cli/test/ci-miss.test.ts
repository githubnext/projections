import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {misses} from '../src/lib/ci-miss.ts'

const plan = {
  gated: ['public-product', 'windows', 'mutants-diff', 'browser', 'browser-macos'],
  checks: ['public-product (ubuntu-latest)', 'mutants-diff', 'browser (packages/renderers/harness, chromium-desktop (database))'],
}

test('a job the plan skipped is a likely miss when it passed on the parent commit', () => {
  const parent = {windows: 'success', 'browser (packages/host/core, 1/3)': 'failure'}
  assert.deepEqual(
    misses({
      failed: [
        'windows',
        'browser (packages/host/core, 1/3)',
        'browser (packages/renderers/harness, webkit-desktop, 1/4)',
        'public-product (ubuntu-latest)',
        'mutants-diff (3)',
        'dollarlint',
      ],
      plan,
      parent,
    }),
    [
      {job: 'windows', verdict: 'likely miss'},
      {job: 'browser (packages/host/core, 1/3)', verdict: 'failing before'},
      {job: 'browser (packages/renderers/harness, webkit-desktop, 1/4)', verdict: 'skipped, no baseline'},
      {job: 'public-product (ubuntu-latest)', verdict: 'ran on the pull request'},
      {job: 'mutants-diff (3)', verdict: 'ran on the pull request'},
      {job: 'dollarlint', verdict: 'not gated'},
    ],
  )
  assert.deepEqual(misses({failed: ['windows']}), [{job: 'windows', verdict: 'no plan'}])
})

test('the miss detector runs on pushes to main after every other job, and never fails the run', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const job = /^ {2}ci-miss:\n([\s\S]*?)\n {2}\S/m.exec(workflow)?.[1] ?? ''
  assert.match(job, /if: always\(\) && github\.event_name == 'push'/)
  assert.match(job, /continue-on-error: true/)
  const ok = /^ {2}ci-ok:\n[\s\S]*?needs:\n((?: {6}- [\w-]+\n)+)/m.exec(workflow)?.[1] ?? ''
  const needs = (block: string) => [...block.matchAll(/^ {6}- ([\w-]+)$/gm)].map(match => match[1])
  assert.deepEqual(needs(job), needs(ok))
})
