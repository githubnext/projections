import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {repoFacts, tomlStrings} from '../src/lib/ci-facts.ts'
import {linuxLayout, rendererGrep} from '../src/lib/ci-browser.ts'
import {ciPlan, nativeBackend} from '../src/lib/ci-plan.ts'

// The plan is checked against this repository's own graph, which it exists to read.
const facts = repoFacts(fileURLToPath(new URL('../../../', import.meta.url)))
const names = (jobs: {name: string}[]) => jobs.map(job => job.name)
const fullBrowserJobs =
  Object.values(linuxLayout)
    .flatMap(projects => Object.values(projects))
    .reduce((a, b) => a + b) + 1

test('the facts come from the repository', () => {
  const suites = facts.browserSuites.map(suite => suite.path)
  for (const suite of [...Object.keys(linuxLayout), ...nativeBackend]) assert.ok(suites.includes(suite), suite)
  assert.ok(facts.browserSuites.find(suite => suite.path === 'packages/host/core')?.uses.includes('tools/storybook'))
  assert.ok(facts.harnessRenderers.includes('database') && !facts.harnessRenderers.includes('kit'))
  assert.deepEqual(facts.coverage, ['packages/engine', 'packages/comparators/default'])
  assert.ok(facts.mutants.examine.includes('packages/engine/src/**/*.rs'))
})

test('TOML arrays skip comments and read either quote', () => {
  assert.deepEqual(tomlStrings('a = [\n  # "not this"\n  "x", \'y\',\n]\nb = ["z"]\n', 'a'), ['x', 'y'])
})

test('a documentation change runs only the docs job', () => {
  const plan = ciPlan(facts, ['README.md', 'docs/guides/host.md', 'packages/renderers/database/README.md'])
  assert.equal(plan.flags.docsOnly, true)
  assert.deepEqual(plan.jobs, {
    docs: true,
    product: [],
    verus: false,
    windows: false,
    windowsNode: false,
    package: false,
    release: false,
    coverage: false,
    mutants: false,
    actionsLock: false,
  })
  assert.deepEqual([...plan.browser, ...plan.browserMacos], [])
})

test('Markdown a generator reads or writes is not documentation only', () => {
  for (const path of ['docs/reference/cli.md', 'docs/setup/install.md', 'packages/cli/templates/SKILL.md']) {
    const plan = ciPlan(facts, [path])
    assert.equal(plan.flags.docsOnly, false, path)
    assert.ok(plan.jobs.product.includes('ubuntu-latest'), path)
  }
})

test("one renderer's change runs that renderer's harness tests, on Linux only", () => {
  const plan = ciPlan(facts, ['packages/renderers/database/src/styles.css'])
  assert.deepEqual(plan.flags.renderers, ['database'])
  assert.deepEqual(plan.jobs.product, ['ubuntu-latest'])
  assert.equal(plan.jobs.windows || plan.jobs.windowsNode || plan.jobs.verus || plan.jobs.mutants || plan.jobs.package, false)
  const harness = plan.browser.filter(job => job.suite === 'packages/renderers/harness')
  assert.deepEqual(
    harness.map(job => [job.project, job.shard]),
    ['chromium-desktop', 'webkit-desktop', 'chromium-mobile', 'webkit-mobile'].map(project => [project, '']),
  )
  assert.ok(harness.every(job => job.grep === rendererGrep(['database'])))
  assert.deepEqual(names(plan.browserMacos), ['packages/renderers/harness, webkit-desktop (database)'])
  // The suites that bundle or build every renderer still run in full.
  for (const suite of ['packages/host/inspector', 'tools/storybook'])
    assert.ok(
      plan.browser.some(job => job.suite === suite),
      suite,
    )
})

test('a renderer grep selects its specs and its scenarios, not other renderers', () => {
  const grep = new RegExp(rendererGrep(['graph']))
  assert.ok(grep.test('graph/browser/dag.spec.ts dag layout'))
  assert.ok(grep.test('harness/browser/checks.spec.ts graph/service-platform: built-in renderer checks pass'))
  assert.ok(grep.test('harness/browser/fill.spec.ts graph zoom enlarges the opening view'))
  assert.ok(!grep.test('database/browser/diff.spec.ts the graph-free diff'))
})

test('a change to the kit every renderer uses runs the whole harness', () => {
  const plan = ciPlan(facts, ['packages/renderers/kit/src/index.ts'])
  assert.deepEqual(plan.flags.renderers, [])
  assert.equal(plan.browser.filter(job => job.suite === 'packages/renderers/harness').length, 12)
})

test('an Engine change runs the Rust, Windows, Verus and mutation jobs and every browser suite', () => {
  const plan = ciPlan(facts, ['packages/engine/src/lib.rs'])
  assert.deepEqual(plan.full, [])
  assert.equal(plan.jobs.windows && plan.jobs.windowsNode && plan.jobs.verus && plan.jobs.coverage && plan.jobs.mutants, true)
  assert.deepEqual(plan.jobs.product, ['ubuntu-latest', 'macos-latest'])
  assert.equal(plan.browser.length, fullBrowserJobs)
  assert.equal(plan.jobs.release, false)
})

test("an extractor's change skips the suites that use only the CLI's backend", () => {
  const plan = ciPlan(facts, ['packages/extractors/django-schema/src/lib.rs'])
  assert.equal(plan.jobs.windows, true)
  assert.equal(plan.jobs.mutants || plan.jobs.verus || plan.jobs.coverage, false)
  assert.deepEqual(names(plan.browser), ['rest'])
  assert.ok(!plan.browser[0]?.except.split(',').includes('packages/cli'))
})

test('CI, toolchain, lockfile and tooling changes, and any reason given, run everything', () => {
  for (const path of [
    '.github/workflows/ci.yml',
    '.github/actions/browser/action.yml',
    'Cargo.lock',
    'tools/cli/src/cli.ts',
    'brand/x.svg',
  ]) {
    const plan = ciPlan(facts, [path])
    assert.ok(plan.full.length, path)
    assert.equal(plan.browser.length, fullBrowserJobs, path)
    assert.equal(plan.jobs.actionsLock && plan.jobs.release && plan.jobs.mutants, true, path)
  }
  assert.deepEqual(ciPlan(facts, ['README.md'], ['the ci:full label']).full, ['the ci:full label'])
})

test('release configuration runs the release check', () => {
  const plan = ciPlan(facts, ['dist-workspace.toml'])
  assert.deepEqual(plan.full, [])
  assert.equal(plan.jobs.release, true)
  assert.deepEqual(plan.browser, [])
})
