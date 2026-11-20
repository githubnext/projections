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
  for (const suite of [...Object.keys(linuxLayout), ...nativeBackend.all, ...nativeBackend.fixtures])
    assert.ok(suites.includes(suite), suite)
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
  const others = facts.harnessRenderers.filter(name => name !== 'database')
  assert.ok(harness.every(job => job.grepInvert === rendererGrep(others)))
  assert.deepEqual(names(plan.browserMacos), ['packages/renderers/harness, webkit-desktop (database)'])
  // The suites that bundle or build every renderer still run in full.
  for (const suite of ['packages/host/inspector', 'tools/storybook'])
    assert.ok(
      plan.browser.some(job => job.suite === suite),
      suite,
    )
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

test("a scenario's extraction or comparator is its renderer's change", () => {
  const plan = ciPlan(facts, ['packages/extractors/tetragon-policies/tests/fixtures/credentials/after.expected.json'])
  assert.deepEqual(plan.flags.renderers, ['runtime-policy'])
  assert.ok(plan.browser.some(job => job.suite === 'packages/renderers/harness'))
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

test("an extractor's change runs the Inspector, which extracts, but not the suites that serve fixtures", () => {
  const plan = ciPlan(facts, ['packages/extractors/django-schema/src/lib.rs'])
  assert.equal(plan.jobs.windows, true)
  assert.equal(plan.jobs.mutants || plan.jobs.verus || plan.jobs.coverage, false)
  assert.deepEqual(names(plan.browser), ['packages/host/inspector, 1/2', 'packages/host/inspector, 2/2', 'rest'])
  assert.ok(plan.browser[2]?.except.split(',').includes('examples/renderers/minimal'))
  assert.ok(!plan.browser[2]?.except.split(',').includes('packages/cli'))
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

test("files a crate's sources read by path are that crate's change, though no manifest says so", () => {
  // The Engine's and default comparator's tests embed the conformance corpus; the Engine's read the generated schemas.
  for (const path of ['packages/schemas/fixtures/conformance.json', 'packages/schemas/schemas/api/v0.json']) {
    const plan = ciPlan(facts, [path])
    assert.ok(plan.changed.includes('packages/engine'), path)
    assert.equal(plan.jobs.coverage && plan.jobs.windows, true, path)
  }
  // Read only by tests: the Engine's suites run, but crates depending on the Engine alone don't change.
  const corpus = ciPlan(facts, ['packages/schemas/fixtures/conformance.json'])
  assert.ok(!corpus.dependants.includes('packages/comparators/rules'))
})

test('any change to a crate is a Rust change, and Markdown test data is not documentation', () => {
  for (const path of [
    'packages/extractors/github-agentic-workflows/vendor/gh-aw/fields.json',
    'packages/extractors/github-agentic-workflows/tests/fixtures/public/.github/workflows/firewall.md',
  ]) {
    const plan = ciPlan(facts, [path])
    assert.equal(plan.flags.docsOnly, false, path)
    assert.equal(plan.jobs.windows && plan.jobs.package, true, path)
  }
})

test("a crate a workspace's build compiles is its dependency, though its manifest doesn't say so", () => {
  // packages/engine/js's build bundles the default comparator; packages/comparators/runtime/js's builds the rules crate.
  const comparator = ciPlan(facts, ['packages/comparators/default/src/lib.rs'])
  assert.ok(comparator.dependants.includes('packages/engine/js'))
  assert.ok(comparator.browser.some(job => job.suite === 'rest' && !job.except.split(',').includes('packages/engine/js')))
  const rules = ciPlan(facts, ['packages/comparators/rules/src/lib.rs'])
  assert.ok(rules.dependants.includes('packages/comparators/runtime/js'))
  assert.ok(rules.browser.some(job => job.suite === 'rest' && !job.except.split(',').includes('packages/comparators/runtime/js')))
})

test('the package check runs for the CLI and what it serves, not for one built-in renderer', () => {
  assert.equal(ciPlan(facts, ['packages/host/inspector/src/app/app.tsx']).jobs.package, true)
  assert.equal(ciPlan(facts, ['packages/renderers/database/src/styles.css']).jobs.package, false)
})

test('release configuration runs the release check', () => {
  const plan = ciPlan(facts, ['dist-workspace.toml'])
  assert.deepEqual(plan.full, [])
  assert.equal(plan.jobs.release, true)
  assert.deepEqual(plan.browser, [])
})
