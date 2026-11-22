import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {Value} from 'typebox/value'
import {repoFacts, tomlStrings} from '../src/lib/ci-facts.ts'
import {rendererGrep} from '../src/lib/ci-browser.ts'
import {ciPlan, executions, planOutputs, type CiPlan} from '../src/lib/ci-plan.ts'
import {ruleProblems} from '../src/lib/ci-rules-check.ts'
import {FULL, loadCiRules, reach, type CiRules} from '../src/lib/ci-rules.ts'
import {CiRules as Schema} from '../src/lib/ci-rules.schema.ts'
import {CiPlanCases, type CiPlanCase} from '../src/lib/ci-plan-cases.schema.ts'

// The plan is checked against this repository's own graph and rules, which it exists to read.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const facts = repoFacts(root)
const rules = loadCiRules(root)
const suites = facts.browserSuites.map(suite => suite.path)
const names = (jobs: {name: string}[]) => jobs.map(job => job.name)

const everything = ciPlan(facts, rules, {paths: [], event: 'schedule'})

function check(plan: CiPlan, expect: CiPlanCase['expect'], label: string) {
  if (expect.full !== undefined) assert.equal(plan.full.length > 0, expect.full, `${label}: full (${plan.full.join('; ')})`)
  if (expect.docsOnly !== undefined) assert.equal(plan.docsOnly, expect.docsOnly, `${label}: docsOnly`)
  for (const [job, value] of Object.entries(expect.jobs ?? {})) assert.deepEqual(plan.jobs[job], value, `${label}: ${job}`)
  for (const os of expect.productIncludes ?? []) assert.ok((plan.jobs['public-product'] as string[]).includes(os), `${label}: ${os}`)
  if (expect.renderers) assert.deepEqual(plan.renderers, expect.renderers, `${label}: renderers`)
  if (expect.browser) assert.deepEqual(names(plan.browser), expect.browser, `${label}: browser`)
  if (expect.macos) assert.deepEqual(names(plan.browserMacos), expect.macos, `${label}: browser-macos`)
  if (expect.allBrowserJobs) {
    assert.deepEqual(names(plan.browser), names(everything.browser), `${label}: browser`)
    assert.deepEqual(names(plan.browserMacos), names(everything.browserMacos), `${label}: browser-macos`)
  }
  if (expect.harnessJobs !== undefined) {
    assert.equal(
      plan.browser.filter(job => job.suite === 'packages/renderers/harness').length,
      expect.harnessJobs,
      `${label}: harness jobs`,
    )
  }
  for (const suite of expect.suitesInclude ?? []) assert.ok(plan.suites.includes(suite), `${label}: runs ${suite}`)
  for (const suite of expect.suitesExclude ?? []) assert.ok(!plan.suites.includes(suite), `${label}: doesn't run ${suite}`)
  for (const unit of expect.changedInclude ?? []) assert.ok(plan.changed.includes(unit), `${label}: changes ${unit}`)
  for (const unit of expect.dependantsInclude ?? []) assert.ok(unit in plan.dependants, `${label}: reaches ${unit}`)
  for (const unit of expect.dependantsExclude ?? []) assert.ok(!(unit in plan.dependants), `${label}: doesn't reach ${unit}`)
  if (expect.classes) {
    assert.deepEqual(
      plan.files.map(file => file.class),
      expect.classes,
      `${label}: classes (${plan.files.map(file => file.rule).join('; ')})`,
    )
  }
}

const table = JSON.parse(readFileSync(new URL('ci-plan.cases.json', import.meta.url), 'utf8')) as CiPlanCases
test('the table of cases matches its schema', () => {
  assert.deepEqual(
    [...Value.Errors(CiPlanCases, table)].map(error => `${error.instancePath} ${error.message}`),
    [],
  )
})
for (const item of table.cases) {
  test(item.name, () => {
    const changes = item.each ? item.files.map(file => [file]) : [item.files]
    for (const events of item.events ?? ['pull_request']) {
      for (const paths of changes) {
        const label = `${paths.join(', ') || 'no files'} (${events})`
        check(ciPlan(facts, rules, {paths, event: events, labels: item.labels ?? []}), item.expect, label)
      }
    }
  })
}

test('the rules file matches its schema, and its references resolve', () => {
  const errors = [...Value.Errors(Schema, rules)].map(error => `${error.instancePath} ${error.message}`)
  assert.deepEqual(errors, [])
  assert.deepEqual(ruleProblems(rules, suites), [])
})

test('the committed JSON Schemas are the ones their TypeBox sources generate', () => {
  const check = spawnSync(process.execPath, ['tools/scripts/ci-schemas.mjs', '--check'], {cwd: root, encoding: 'utf8'})
  assert.equal(check.status, 0, check.stderr)
})

test('the rules checks catch references to groups, conditions and suites that do not exist', () => {
  const broken = structuredClone(rules) as CiRules
  broken.jobs.verus = {description: 'x', when: {any: [{if: 'nope'}, {reaches: 'nobody'}, {not: {touches: 'none'}}]}}
  broken.browser.suites['packages/nothing'] = {description: 'x'}
  assert.deepEqual(ruleProblems(broken, suites), [
    'jobs.verus.any[0]: no condition nope',
    'jobs.verus.any[1]: no group nobody',
    'jobs.verus.any[2].not: no group none',
    'browser.suites: packages/nothing has no test:browser script',
  ])
  assert.throws(() => ciPlan(facts, broken, {paths: []}), /no condition nope/u)
})

test('the workflow gates each job on the rules decision of the same name', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const gated = new Set([...workflow.matchAll(/needs\.changes\.outputs\.([\w-]+)/gu)].map(match => match[1]!))
  const mapped = new Set(
    [...workflow.matchAll(/^ {6}([\w-]+): \$\{\{ steps\.plan\.outputs\.([\w-]+) \}\}$/gmu)].filter(m => m[1] === m[2]).map(m => m[1]),
  )
  const outputs = [...Object.keys(rules.jobs), 'browser', 'browser-macos']
  assert.deepEqual([...gated].sort(), [...outputs].sort())
  assert.deepEqual([...mapped].sort(), [...outputs].sort())
  for (const job of Object.keys(rules.jobs)) assert.match(workflow, new RegExp(`^  ${job}:$`, 'm'), job)
})

test("public-product's output is the workflow's matrix.include: each chosen entry's name, runner and part", () => {
  const include = (paths: string[], event = 'pull_request') =>
    JSON.parse(planOutputs(ciPlan(facts, rules, {paths, event}))['public-product']!) as unknown
  const linux = {name: 'ubuntu-latest', os: 'ubuntu-latest', part: 'all'}
  const macos = [
    {name: 'macos-latest, Rust', os: 'macos-latest', part: 'rust'},
    {name: 'macos-latest, Node', os: 'macos-latest', part: 'node'},
  ]
  assert.deepEqual(include(['README.md']), [])
  assert.deepEqual(include(['packages/renderers/database/src/styles.css']), [linux])
  assert.deepEqual(include(['packages/engine/src/lib.rs']), [linux, ...macos])
  assert.deepEqual(include([], 'schedule'), [linux, ...macos])
  // A job's decision is a string GitHub Actions compares with 'true'.
  assert.equal(planOutputs(ciPlan(facts, rules, {paths: ['README.md']})).docs, 'true')
})

test('the facts come from the repository', () => {
  for (const suite of Object.keys(rules.browser.suites)) assert.ok(suites.includes(suite), suite)
  assert.ok(facts.browserSuites.find(suite => suite.path === 'packages/host/core')?.uses.includes('tools/storybook'))
  assert.ok(facts.harnessRenderers.includes('database') && !facts.harnessRenderers.includes('kit'))
  assert.deepEqual(facts.coverage, ['packages/engine', 'packages/comparators/default'])
  assert.ok(facts.mutants.examine.includes('packages/engine/src/**/*.rs'))
})

test('TOML arrays skip comments and read either quote', () => {
  assert.deepEqual(tomlStrings('a = [\n  # "not this"\n  "x", \'y\',\n]\nb = ["z"]\n', 'a'), ['x', 'y'])
})

test('a renderer grep matches its specs and the tests titled for it alone; inverted, it keeps the rest', () => {
  // Playwright matches --grep-invert against the project, file and title, joined by spaces.
  const grep = new RegExp(rendererGrep(['graph']))
  assert.ok(grep.test('chromium-desktop graph/browser/dag.spec.ts dag layout'))
  assert.ok(grep.test('chromium-desktop harness/browser/checks.spec.ts graph/service-platform: built-in renderer checks pass'))
  assert.ok(grep.test('chromium-desktop harness/browser/identifiers.spec.ts graph: identifiers are marked'))
  // Tests that span renderers, or name none, stay.
  assert.ok(!grep.test('chromium-desktop harness/browser/diff.spec.ts graph diffs at 1440px: data whole, opening fitted'))
  assert.ok(!grep.test('chromium-desktop harness/browser/annotations.spec.ts annotation badges stay clear (graph/service-platform)'))
  assert.ok(!grep.test('chromium-desktop database/browser/diff.spec.ts the graph-free diff'))
  assert.ok(!grep.test('chromium-desktop harness/browser/harness.spec.ts the harness runs a bundle in the real host frame'))
})

test('a full run says why, and a run following the change gives each job its reasons', () => {
  const labelled = ciPlan(facts, rules, {paths: ['README.md'], labels: ['ci:full']})
  assert.deepEqual(labelled.full, ['the ci:full label'])
  assert.deepEqual(labelled.why.verus, [FULL])
  const plan = ciPlan(facts, rules, {paths: ['packages/engine/src/lib.rs']})
  assert.deepEqual(plan.why.windows, [rules.conditions.rust?.description])
  // A predicate on files or units, with no condition to name: the job's own description.
  assert.deepEqual(plan.why['mutants-diff'], [rules.jobs['mutants-diff']?.description])
  assert.deepEqual(plan.why.verus, [rules.jobs.verus?.description])
  assert.deepEqual(ciPlan(facts, rules, {paths: ['README.md']}).why.docs, [rules.jobs.docs?.description])
})

test("a lockfile change runs the jobs for what its changed packages reach; the root's own tooling, everything", () => {
  const lock = readFileSync(new URL('../../../package-lock.json', import.meta.url), 'utf8')
  const packages = (JSON.parse(lock) as {packages: Record<string, {version?: string; dependencies?: object}>}).packages
  const bump = (key: string) => {
    const changed = structuredClone(packages)
    ;(changed[key] as {version?: string}).version = '999.0.0'
    return JSON.stringify({...JSON.parse(lock), packages: changed})
  }
  const plan = (after: string, before: string | undefined) =>
    ciPlan(facts, rules, {paths: ['package-lock.json'], contents: {before: () => before, after: () => after}})
  // A dependency of the VS Code extension alone: that extension, nothing else.
  const vscode = plan(bump('node_modules/@vscode/test-electron'), lock)
  assert.deepEqual(vscode.full, [])
  assert.deepEqual(vscode.changed, ['packages/integrations/vscode'])
  assert.deepEqual(plan(bump('node_modules/eslint'), lock).full.length, 1)
  assert.match(plan(lock, undefined).full[0]!, /no earlier version/u)
})

test('a unit is reached through what it depends on, not through a crate whose tests alone read the change', () => {
  const units = [
    {path: 'a', dependsOn: []},
    {path: 'b', dependsOn: ['a']},
    {path: 'c', dependsOn: ['b']},
    {path: 't', dependsOn: ['a']},
    {path: 'u', dependsOn: ['t']},
  ] as unknown as Parameters<typeof reach>[0]
  assert.deepEqual(Object.fromEntries(reach(units, ['a'], new Set())), {a: 'a', b: 'a', t: 'a', c: 'b', u: 't'})
  // Only t's tests read the change: t's suites run, u is not reached.
  assert.deepEqual(Object.fromEntries(reach(units, ['t'], new Set(['t']))), {t: 't'})
  // t is tested-only and also depends on the built a: its dependants are reached through it.
  assert.deepEqual(Object.fromEntries(reach(units, ['a', 't'], new Set(['t']))), {a: 'a', t: 't', b: 'a', c: 'b', u: 't'})
})

test('the execution plan names each check with the suites, projects, shards and filters it runs', () => {
  const plan = ciPlan(facts, rules, {paths: ['packages/renderers/database/src/styles.css']})
  const run = executions(plan, rules)
  const rest = run.find(item => item.check === 'browser (rest)')
  assert.deepEqual(
    rest?.suites,
    plan.suites.filter(suite => !rules.browser.suites[suite]?.shards),
  )
  const harness = run.filter(item => item.suites?.includes('packages/renderers/harness'))
  assert.ok(harness.length > 0 && harness.every(item => item.grepInvert && item.project))
  assert.deepEqual(
    run.filter(item => item.job === 'public-product').map(item => item.with),
    [{os: 'ubuntu-latest', part: 'all'}],
  )
  assert.equal(run.filter(item => item.job === 'browser').length, plan.browser.length)
})

test("a job the workflow shards is one check per shard, and a job limited to some events doesn't run for others", () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  for (const [job, definition] of Object.entries(rules.jobs)) {
    if (!('shards' in definition) || !definition.shards) continue
    const block = new RegExp(`^  ${job}:\\n([\\s\\S]*?)\\n  \\S`, 'm').exec(workflow)?.[1] ?? ''
    const shards = /shard: \[([\d, ]+)\]/u.exec(block)?.[1]?.split(',').map(Number)
    assert.deepEqual(
      shards,
      Array.from({length: definition.shards}, (_, index) => index),
      `${job}'s matrix`,
    )
    assert.match(block, new RegExp(`shard: \\$\\{\\{ matrix\\.shard \\}\\}/${definition.shards}`), `${job}'s shard argument`)
  }
  const engine = ciPlan(facts, rules, {paths: ['packages/engine/src/lib.rs']})
  assert.deepEqual(
    executions(engine, rules)
      .filter(item => item.job === 'mutants-diff')
      .map(item => item.check),
    ['mutants-diff (0)', 'mutants-diff (1)', 'mutants-diff (2)', 'mutants-diff (3)', 'mutants-diff (4)', 'mutants-diff (5)'],
  )
  assert.equal(ciPlan(facts, rules, {paths: [], event: 'push'}).jobs['mutants-diff'], false)
  assert.equal(ciPlan(facts, rules, {paths: ['README.md'], labels: ['ci:full']}).jobs['mutants-diff'], true)
})
