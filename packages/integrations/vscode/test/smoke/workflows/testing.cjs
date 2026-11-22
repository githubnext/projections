// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function testing({tests}) {
  // The Testing view, with no panel open: one "Projections" controller with an item per projection (its checks) and,
  // since no projection uses it, the workspace's comparator test file on its own, its cases at their lines (the gutter
  // runs them). Running it reports a pass, and a failure at the line it is about.
  assert.deepEqual(tests.controller(), {id: 'projections', label: 'Projections'})
  const testFile = await until('the comparator tests', async () =>
    tests.items().find(item => item.path === 'tools/first.comparator.test.yaml' && item.children.length === 2),
  )
  assert.deepEqual(
    testFile.children.map(item => [item.id, item.line]),
    [
      ['case:tools/first.comparator.test.yaml#core leads', 6],
      ['case:tools/first.comparator.test.yaml#billing leads', 11],
    ],
  )
  const projectionTests = await until('the projection in the Testing view', async () =>
    tests.items().find(item => item.id.endsWith('|projection:packages') && item.children.length),
  )
  assert.equal(projectionTests.label, 'Packages')
  assert.deepEqual(
    projectionTests.children.map(item => item.label),
    ['Definition valid', 'Extraction', 'Determinism', 'Scope', 'Renderer checks'],
  )
  assert.equal(testFile.error, undefined)
  assert.equal(tests.profiles().includes('Update snapshots'), vscode.workspace.isTrusted)
  const results = await tests.run()
  assert.equal(results['tools/first.comparator.test.yaml#core leads']?.state, 'passed', JSON.stringify(results))
  const failed = results['tools/first.comparator.test.yaml#billing leads']
  assert.equal(failed?.state, 'failed', JSON.stringify(results))
  assert.equal(failed.messages[0].path, 'tools/first.comparator.test.yaml')
  assert.equal(failed.messages[0].line, 15)
  assert.match(failed.messages[0].message, /package:@acme\/billing/u)
  assert.ok(failed.messages[0].expected.includes('package:@acme/billing'), JSON.stringify(failed))
  // One case alone.
  const one = await tests.run({path: 'tools/first.comparator.test.yaml', cases: ['core leads']})
  assert.equal(one['tools/first.comparator.test.yaml#core leads'].state, 'passed')
  // A projection's checks run `projections check` through the backend: each check is a test with its result.
  const checked = await tests.run({projection: 'packages'})
  assert.equal(checked['packages/check:definition']?.state, 'passed', JSON.stringify(checked))
  assert.equal(checked['packages/check:extract']?.state, 'passed', JSON.stringify(checked))
  assert.ok(
    ['packages/check:determinism', 'packages/check:scope', 'packages/check:renderer'].every(key =>
      ['passed', 'failed', 'skipped'].includes(checked[key]?.state),
    ),
    JSON.stringify(checked),
  )
}
