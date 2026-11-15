import assert from 'node:assert/strict'
import test from 'node:test'
import {parseScriptResult, shadcnCommand, shadcnSummary} from '../src/commands/update.ts'

const registry = {repository: 'shadcn-ui/ui', head: 'abcdef0123456789', moved: []}
const result = (mode: 'check' | 'dry-run' | 'update', components: {name: string; status: string; conflicts?: number; line?: number}[]) => ({
  status: components.some(component => ['changed', 'conflict'].includes(component.status)) ? ('fail' as const) : ('pass' as const),
  mode,
  style: 'radix-vega',
  ours: 'shadcn@4.23.0',
  upstream: 'shadcn@4.24.0',
  registry,
  components,
  written: mode === 'update',
})

test('the script runs with --json and the request’s flags and components', () => {
  assert.deepEqual(shadcnCommand({dryRun: true, version: '4.24.0', components: ['card']}).argv, [
    'node',
    'packages/host/core/scripts/shadcn/update.mjs',
    '--json',
    '--dry-run',
    '--version',
    '4.24.0',
    'card',
  ])
})

test('the result is the last JSON line, after any warnings', () => {
  const output = '(node:1) ExperimentalWarning: something\n{"error":{"kind":"usage","message":"no"}}\n'
  assert.deepEqual(parseScriptResult(output), {error: {kind: 'usage', message: 'no'}})
  assert.equal(parseScriptResult('Error: boom\n    at x'), undefined)
})

test('check: changed components are problems, and next previews then updates', () => {
  const summary = shadcnSummary(
    result('check', [
      {name: 'card', status: 'changed'},
      {name: 'badge', status: 'unchanged'},
    ]),
    {check: true},
  )
  assert.equal(summary.status, 'fail')
  assert.deepEqual(summary.problems, [
    {file: 'packages/host/core/src/ui/components/card.tsx', line: undefined, message: 'changed upstream since shadcn@4.23.0'},
  ])
  assert.deepEqual(summary.next, ['npm run tools -- update shadcn --dry-run', 'npm run tools -- update shadcn'])
})

test('update: a conflict points at its first marker; a dry run has no line to point at', () => {
  const conflict = {name: 'select', status: 'conflict', conflicts: 2, line: 41}
  const written = shadcnSummary(result('update', [conflict]), {})
  assert.deepEqual(written.problems, [
    {
      file: 'packages/host/core/src/ui/components/select.tsx',
      line: 41,
      message: '2 conflict(s) merging shadcn@4.24.0: resolve the diff3 markers (ours, base, upstream)',
    },
  ])
  assert.ok(written.next.includes('npm run tools -- test host'))
  const preview = shadcnSummary(result('dry-run', [conflict]), {dryRun: true, version: '4.24.0'})
  assert.equal(preview.problems[0]?.line, undefined)
  assert.deepEqual(preview.next, ['npm run tools -- update shadcn --version 4.24.0'])
})
