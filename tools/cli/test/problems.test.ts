import assert from 'node:assert/strict'
import test from 'node:test'
import {normalizePath, parseConsidered, parseFormatCheck, parseProblems, parseStalePages, tail} from '../src/lib/problems.ts'
import {counts} from '../src/commands/work/test.ts'
import {compareVersions, satisfies} from '../src/lib/versions.ts'

const root = '/repo'

test('TypeScript diagnostics, relative to the workspace npm ran in', () => {
  const output = [
    '> @x/graph@0.0.0 typecheck',
    'npm error path /repo/renderers/graph',
    'src/layout.ts(12,5): error TS2322: Type string is not assignable to type number.',
    '/repo/host/src/a.tsx:3:1 - error TS2304: Cannot find name x.',
  ].join('\n')
  assert.deepEqual(parseProblems(output, root), [
    {file: 'renderers/graph/src/layout.ts', line: 12, message: 'TS2322: Type string is not assignable to type number.'},
    {file: 'host/src/a.tsx', line: 3, message: 'TS2304: Cannot find name x.'},
  ])
  assert.deepEqual(parseProblems('src/a.ts(1,1): error TS1: m', root, 'cli'), [{file: 'cli/src/a.ts', line: 1, message: 'TS1: m'}])
})

test('ESLint stylish output', () => {
  const output =
    "/repo/renderers/graph/src/x.ts\n  3:9  error  Expected '===' and instead saw '=='  eqeqeq\n\n✖ 1 problem (1 error, 0 warnings)\n"
  assert.deepEqual(parseProblems(output, root), [
    {file: 'renderers/graph/src/x.ts', line: 3, message: "Expected '===' and instead saw '==' (eqeqeq)"},
  ])
})

test('rustc, clippy, rustfmt and cargo test failures', () => {
  const rustc = 'error[E0308]: mismatched types\n  --> packages/engine/src/lib.rs:10:5\n   |\nerror: could not compile `x`'
  assert.deepEqual(parseProblems(rustc, root), [{file: 'packages/engine/src/lib.rs', line: 10, message: 'error[E0308]: mismatched types'}])
  assert.deepEqual(parseProblems('packages/cli/src/main.rs:4:9: warning: unused variable: `x`', root), [
    {file: 'packages/cli/src/main.rs', line: 4, message: 'warning: unused variable: `x`'},
  ])
  assert.deepEqual(parseProblems('Diff in /repo/engine/src/volatility.rs:864:\n', root), [
    {file: 'engine/src/volatility.rs', line: 864, message: 'not formatted (cargo fmt)'},
  ])
  const panic = "thread 'parses_x' panicked at engine/tests/a.rs:7:5:\nassertion `left == right` failed\nnote: run with RUST_BACKTRACE=1"
  assert.deepEqual(parseProblems(panic, root), [
    {file: 'engine/tests/a.rs', line: 7, message: 'parses_x: assertion `left == right` failed'},
  ])
})

test('node:test TAP failures with their location and error', () => {
  const output = [
    'not ok 2 - adds numbers',
    '  ---',
    '  duration_ms: 1.2',
    "  location: '/repo/tools/test/a.test.ts:5:1'",
    "  failureType: 'testCodeFailure'",
    '  error: |-',
    '    Expected values to be strictly equal:',
    '  code: ERR_ASSERTION',
    '  ...',
    'ok 3 - other',
    'not ok 4 - quick',
    "  location: '/repo/tools/test/b.test.ts:9:3'",
    "  error: 'boom'",
    '# pass 1',
    '# fail 2',
  ].join('\n')
  assert.deepEqual(parseProblems(output, root), [
    {file: 'tools/test/a.test.ts', line: 5, message: 'adds numbers: Expected values to be strictly equal:'},
    {file: 'tools/test/b.test.ts', line: 9, message: 'quick: boom'},
  ])
  assert.deepEqual(counts(output), {passed: 1, failed: 2})
})

test('node:test spec reporter failures, at the failing assertion', () => {
  const output = [
    '✔ passes (1ms)',
    '✖ failing tests:',
    '',
    'test at test/cli.test.ts:114:1',
    '✖ the manifest lists every command (1.96ms)',
    '  AssertionError [ERR_ASSERTION]: map',
    '      at TestContext.<anonymous> (file:///repo/tools/cli/test/cli.test.ts:117:12)',
    '      at async Test.run (node:internal/test_runner/test:1409:7) {',
    '',
    'test at test/other.test.ts:3:1',
    '✖ throws (0.2ms)',
    '  Error: boom',
    'ℹ pass 1',
    'ℹ fail 2',
  ].join('\n')
  assert.deepEqual(parseProblems(output, root, 'tools/cli'), [
    {file: 'tools/cli/test/cli.test.ts', line: 117, message: 'the manifest lists every command: map'},
    {file: 'tools/cli/test/other.test.ts', line: 3, message: 'throws: Error: boom'},
  ])
  assert.deepEqual(counts(output), {passed: 1, failed: 2})
})

test('check scripts: path:line: message and path: message', () => {
  assert.deepEqual(
    parseProblems(
      'packages/renderers/sdk/src/a.ts:4: imports node:fs in browser source\npackages/host/core/package.json: depends on a private package\n',
      root,
    ),
    [
      {file: 'packages/renderers/sdk/src/a.ts', line: 4, message: 'imports node:fs in browser source'},
      {file: 'packages/host/core/package.json', line: undefined, message: 'depends on a private package'},
    ],
  )
  assert.deepEqual(parseProblems('see https://example.com/a/b.html: nothing', root), [])
})

test('oxfmt lists, stale reference pages, counts and tails', () => {
  assert.deepEqual(parseFormatCheck('Checking formatting...\nrenderers/graph/src/x.ts (3ms)\ntools/a.json\nFinished in 9ms\n', root), [
    {file: 'renderers/graph/src/x.ts', line: undefined, message: 'not formatted (oxfmt)'},
    {file: 'tools/a.json', line: undefined, message: 'not formatted (oxfmt)'},
  ])
  assert.deepEqual(
    parseStalePages(
      'Generated reference pages are stale:\n  docs/reference/cli.md\n  docs/agents/x.md (no longer generated)\nRun `npm run docs:generate`',
    ),
    [
      {file: 'docs/reference/cli.md', line: 1, message: 'stale'},
      {file: 'docs/agents/x.md', line: 1, message: 'no longer generated'},
    ],
  )
  assert.deepEqual(counts('test result: ok. 12 passed; 0 failed; 0 ignored\n  3 passed (2.1s)\n  1 failed\n'), {passed: 15, failed: 1})
  assert.deepEqual(counts('nothing'), {})
  assert.deepEqual(tail('a\n\n\x1b[31mb\x1b[0m\nc\n', 2), ['b', 'c'])
  assert.equal(normalizePath('file:///repo/x/y.ts', root), 'x/y.ts')
})

test('considered violations', () => {
  const report = {
    violations: [
      {subject: 'cli/src/a.rs', metric: 'scc.complexity', actual: 61, standard: {max: 50}, provider: 'scc'},
      {subject: 'b.ts', metric: 'x.coverage', actual: 3, standard: {min: 5}, provider: 'x'},
    ],
    warnings: [{subject: 'c.ts', metric: 'scc.code_lines', actual: 480, standard: {max: 500}}],
    variances: [],
  }
  assert.deepEqual(parseConsidered(`${JSON.stringify(report)}\n`), [
    {file: 'cli/src/a.rs', line: undefined, message: 'scc.complexity is 61, over the maximum of 50'},
    {file: 'b.ts', line: undefined, message: 'x.coverage is 3, under the minimum of 5'},
  ])
  assert.deepEqual(parseConsidered('considered v0.1.6 is not installed.'), [])
})

test('versions and ranges', () => {
  assert.ok(compareVersions('26.12.1', '26.9.0') > 0)
  assert.ok(satisfies('26.12.1', '>=26.12.1'))
  assert.ok(!satisfies('22.0.0', '>=26.12.1'))
  assert.ok(satisfies('8.0.404', '8.0.x'))
  assert.ok(satisfies('1.2.3', '^1.0.0') && !satisfies('2.0.0', '^1.0.0'))
  assert.ok(satisfies('1.2.9', '~1.2.3') && !satisfies('1.3.0', '~1.2.3'))
})

test('npm run check and tools check run the same gates: each step of the check script is a tools gate', async () => {
  const {readFileSync} = await import('node:fs')
  const path = await import('node:path')
  const {gates} = await import('../src/lib/gates.ts')
  const {workspaceRoot} = await import('../src/lib/repo.ts')
  const scripts = JSON.parse(readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')).scripts as Record<string, string>
  const split = (script: string): string[] =>
    script
      .split('&&')
      .map(step => step.trim().replace(/^npm (run )?/, ''))
      .flatMap(step => (step === 'check:no-test' ? split(scripts[step]!) : [step]))
  const steps = split(scripts.check!)
  // `npm test` runs the unit suites, which `tools test` covers rather than `tools check`.
  const gateOf = (step: string) => (step === 'test' ? undefined : step.replace(/^check:/, '').replace(/^format:check$/, 'format'))
  const names = new Set(gates.map(gate => gate.name))
  for (const step of steps) {
    const gate = gateOf(step)
    if (gate) assert.ok(names.has(gate), `npm run check runs ${step}, but tools check has no ${gate} gate`)
  }
})
