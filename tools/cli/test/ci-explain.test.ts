import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {ciExplainReport} from '../src/commands/work/ci.ts'
import {repoFacts} from '../src/lib/ci-facts.ts'
import {explain} from '../src/lib/ci-explain.ts'
import {ciPlan, executions} from '../src/lib/ci-plan.ts'
import {loadCiRules} from '../src/lib/ci-rules.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const facts = repoFacts(root)
const rules = loadCiRules(root)
const why = (explanation: ReturnType<typeof explain>, check: string) =>
  explanation.jobs.find(job => job.check === check)?.why ?? explanation.suites.find(suite => suite.suite === check)?.why

test("explain names each file's rule, the chain that reached each unit, and why each job ran or didn't", () => {
  const plan = ciPlan(facts, rules, {paths: ['packages/renderers/database/src/styles.css']})
  const explanation = explain(plan, rules, facts)
  assert.deepEqual(explanation.files, [
    {path: 'packages/renderers/database/src/styles.css', class: 'code', rule: 'A file of packages/renderers/database'},
  ])
  assert.deepEqual(explanation.reached.find(item => item.unit === 'packages/cli')?.through, [
    'packages/host/inspector',
    'packages/renderers/database',
  ])
  // A skipped job shows every predicate that didn't hold; one that ran, the one that did.
  assert.deepEqual(why(explanation, 'windows'), [
    `✗ rust: ${rules.conditions.rust?.description}`,
    '  ✗ any of',
    '    ✗ changes **/*.rs, **/Cargo.toml, **/Cargo.lock, rust-toolchain.toml',
    '    ✗ touches crates',
  ])
  assert.ok(
    why(explanation, 'package')?.includes('  ✓ reaches cli: packages/cli (through packages/host/inspector ← packages/renderers/database)'),
  )
  assert.ok(why(explanation, 'packages/renderers/harness')?.some(line => line.startsWith('narrowed to database')))
  assert.deepEqual(explanation.checks, executions(plan, rules))
  assert.equal(explanation.jobs.length, 13)
})

test('explain says a full run runs everything, and why', () => {
  const explanation = explain(ciPlan(facts, rules, {paths: ['README.md'], labels: ['ci:full']}), rules, facts)
  assert.deepEqual(why(explanation, 'verus'), ['Everything runs: the ci:full label'])
  assert.ok(explanation.jobs.every(job => job.runs))
})

test('ci explain plans named files, and compares a lockfile with its version at the merge base', () => {
  const report = ciExplainReport(root, {files: ['README.md', 'docs/guides/host.md'], base: 'HEAD', event: 'pull_request', labels: []})
  assert.deepEqual(
    report.jobs.filter(job => job.runs).map(job => job.check),
    ['docs'],
  )
  // Unchanged from the merge base, so its resolved dependencies reach nothing.
  const lock = ciExplainReport(root, {files: ['package-lock.json'], base: 'HEAD', event: 'pull_request', labels: []})
  assert.deepEqual(lock.full, [])
})

test('the generated table of what runs for what is current', () => {
  const check = spawnSync(process.execPath, ['tools/scripts/ci-table.mjs', '--check'], {cwd: root, encoding: 'utf8'})
  assert.equal(check.status, 0, check.stderr)
})

test('ci explain reads named files as repository paths', () => {
  const plain = ciExplainReport(root, {
    files: ['packages/renderers/database/src/styles.css'],
    base: 'HEAD',
    event: 'pull_request',
    labels: [],
  })
  for (const file of ['./packages/renderers/database/src/styles.css', `${root}packages/renderers/database/src/styles.css`]) {
    const report = ciExplainReport(root, {files: [file], base: 'HEAD', event: 'pull_request', labels: []})
    assert.deepEqual(report.files, plain.files, file)
  }
})
