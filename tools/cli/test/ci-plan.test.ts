import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {Value} from 'typebox/value'
import {repoFacts, tomlStrings} from '../src/lib/ci-facts.ts'
import {rendererGrep} from '../src/lib/ci-browser.ts'
import {ciPlan, type CiPlan} from '../src/lib/ci-plan.ts'
import {ruleProblems} from '../src/lib/ci-rules-check.ts'
import {FULL, loadCiRules, type CiRules} from '../src/lib/ci-rules.ts'
import {CiRules as Schema} from '../src/lib/ci-rules.schema.ts'

// The plan is checked against this repository's own graph and rules, which it exists to read.
const root = fileURLToPath(new URL('../../../', import.meta.url))
const facts = repoFacts(root)
const rules = loadCiRules(root)
const suites = facts.browserSuites.map(suite => suite.path)
const names = (jobs: {name: string}[]) => jobs.map(job => job.name)

/** One table case (ci-plan.cases.json): files, as one change or (`each`) one change apiece, and what to expect. */
type Case = {
  name: string
  files: string[]
  each?: boolean
  labels?: string[]
  events?: string[]
  expect: {
    full?: boolean
    docsOnly?: boolean
    jobs?: Record<string, boolean | string[]>
    productIncludes?: string[]
    renderers?: string[]
    browser?: string[]
    macos?: string[]
    allBrowserJobs?: boolean
    harnessJobs?: number
    suitesInclude?: string[]
    suitesExclude?: string[]
    changedInclude?: string[]
    dependantsInclude?: string[]
    dependantsExclude?: string[]
  }
}

const everything = ciPlan(facts, rules, {paths: [], event: 'schedule'})

function check(plan: CiPlan, expect: Case['expect'], label: string) {
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
  if (expect.harnessJobs !== undefined)
    assert.equal(
      plan.browser.filter(job => job.suite === 'packages/renderers/harness').length,
      expect.harnessJobs,
      `${label}: harness jobs`,
    )
  for (const suite of expect.suitesInclude ?? []) assert.ok(plan.suites.includes(suite), `${label}: runs ${suite}`)
  for (const suite of expect.suitesExclude ?? []) assert.ok(!plan.suites.includes(suite), `${label}: doesn't run ${suite}`)
  for (const unit of expect.changedInclude ?? []) assert.ok(plan.changed.includes(unit), `${label}: changes ${unit}`)
  for (const unit of expect.dependantsInclude ?? []) assert.ok(plan.dependants.includes(unit), `${label}: reaches ${unit}`)
  for (const unit of expect.dependantsExclude ?? []) assert.ok(!plan.dependants.includes(unit), `${label}: doesn't reach ${unit}`)
}

const cases = JSON.parse(readFileSync(new URL('ci-plan.cases.json', import.meta.url), 'utf8')) as Case[]
for (const item of cases) {
  test(item.name, () => {
    const changes = item.each ? item.files.map(file => [file]) : [item.files]
    for (const events of item.events ?? ['pull_request'])
      for (const paths of changes) {
        const label = `${paths.join(', ') || 'no files'} (${events})`
        check(ciPlan(facts, rules, {paths, event: events, labels: item.labels ?? []}), item.expect, label)
      }
  })
}

test('the rules file matches its schema, and its references resolve', () => {
  const errors = [...Value.Errors(Schema, rules)].map(error => `${error.instancePath} ${error.message}`)
  assert.deepEqual(errors, [])
  assert.deepEqual(ruleProblems(rules, suites), [])
})

test('the rules checks catch references to groups, conditions, tags and suites that do not exist', () => {
  const broken = structuredClone(rules) as CiRules
  broken.jobs.verus = {description: 'x', when: {any: [{if: 'nope'}, {reaches: 'nobody', from: 'cli'}, {tag: 'none'}, 'reachesSuite']}}
  broken.browser.suites['packages/nothing'] = {description: 'x'}
  assert.deepEqual(ruleProblems(broken, suites), [
    'jobs.verus.any[0]: no condition nope',
    'jobs.verus.any[1]: no group nobody',
    'jobs.verus.any[2]: no tag none',
    'jobs.verus.any[3]: reachesSuite outside a browser suite',
    'browser.suites: packages/nothing has no test:browser script',
  ])
  assert.throws(() => ciPlan(facts, broken, {paths: []}), /no condition nope/)
})

test('the workflow gates each job on the rules decision of the same name', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const gated = new Set([...workflow.matchAll(/needs\.changes\.outputs\.([\w-]+)/g)].map(match => match[1] as string))
  const mapped = new Set(
    [...workflow.matchAll(/^ {6}([\w-]+): \$\{\{ steps\.plan\.outputs\.([\w-]+) \}\}$/gm)].filter(m => m[1] === m[2]).map(m => m[1]),
  )
  const outputs = [...Object.keys(rules.jobs), 'browser', 'browser-macos']
  assert.deepEqual([...gated].sort(), [...outputs].sort())
  assert.deepEqual([...mapped].sort(), [...outputs].sort())
  for (const job of Object.keys(rules.jobs)) assert.match(workflow, new RegExp(`^  ${job}:$`, 'm'), job)
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
  assert.deepEqual(plan.why.verus, [rules.conditions.engine?.description])
  assert.deepEqual(plan.why.windows, [rules.conditions.rust?.description])
})
