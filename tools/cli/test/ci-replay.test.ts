import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {loadCiRules} from '../src/lib/ci-rules.ts'
import {checkoutPlanner, loadPlanner, mergedCommits, price, PRICES, replay} from '../src/lib/ci-replay.ts'
import {git} from '../src/lib/repo.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const lib = join(root, 'tools/cli/src/lib')
// CI checks out one commit; the history test needs a few.
const shallow = git(root, ['rev-parse', '--is-shallow-repository']) === 'true'

test('a replay finds what a rules change runs differently, by check, and prices it', async () => {
  const rules = loadCiRules(root)
  const changed = structuredClone(rules)
  delete changed.browser.suites['packages/renderers/harness']?.narrow
  const directory = mkdtempSync(join(tmpdir(), 'ci-replay-test-'))
  try {
    mkdirSync(join(directory, '.github'))
    writeFileSync(join(directory, '.github/ci-rules.json'), JSON.stringify(changed))
    const before = await loadPlanner(root, lib, root)
    const after = await loadPlanner(root, lib, directory)
    const result = replay(before, after, [], ['packages/renderers/database/src/styles.css', 'README.md'], root)
    assert.equal(result.files?.changed, 1)
    const [kind] = result.files.kinds
    assert.deepEqual(kind?.examples, ['packages/renderers/database/src/styles.css'])
    assert.ok(kind.added.includes('browser (packages/renderers/harness, webkit-desktop, 4/4)'))
    assert.ok(kind.removed.includes('browser (packages/renderers/harness, webkit-desktop (database))'))
    assert.ok(result.files.minutes > 100)
    assert.deepEqual(result.unpriced, [])
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
})

test('the planner at a ref replays its own history unchanged', {skip: shallow && 'a shallow clone has no history'}, async () => {
  const checkout = checkoutPlanner(root, 'HEAD')
  try {
    const planner = await loadPlanner(root, join(checkout.directory, 'tools/cli/src/lib'), checkout.directory)
    const commits = mergedCommits(root, 'HEAD', 3)
    assert.equal(commits.length, 3)
    const result = replay(planner, planner, commits, undefined, root)
    assert.deepEqual(result.commits.differences, [])
    assert.equal(result.commits.before.minutes, result.commits.after.minutes)
  } finally {
    checkout.remove()
  }
})

test('browser (rest) is priced by the suites it runs; sharded workflow jobs by their runners', () => {
  const rest = (suites: string[]) => price([{check: 'browser (rest)', job: 'browser', suites}]).minutes
  assert.equal(rest([]), PRICES.rest.setup)
  assert.equal(rest(['packages/cli', 'examples/renderers/minimal']), PRICES.rest.setup + 3.2 + 0.25)
  const mutants = price(
    Array.from({length: 6}, (_, shard) => ({check: `mutants-diff (${shard})`, job: 'mutants-diff', shard: String(shard)})),
  )
  assert.equal(mutants.runners, 6)
  assert.equal(Math.round(mutants.minutes * 10), 126)
  assert.deepEqual(price([{check: 'nothing known', job: 'x'}]).unpriced, ['nothing known'])
  // A suite with no measured time in rest is named, not silently free.
  assert.deepEqual(price([{check: 'browser (rest)', job: 'browser', suites: ['packages/host/core']}]).unpriced, [
    'browser (rest): packages/host/core',
  ])
  // The order of an execution's keys doesn't make it a different check.
  assert.deepEqual(
    price([{check: 'p (x)', job: 'p', with: {os: 'a', part: 'b'}}]).checks,
    price([{job: 'p', with: {part: 'b', os: 'a'}, check: 'p (x)'}]).checks,
  )
})
