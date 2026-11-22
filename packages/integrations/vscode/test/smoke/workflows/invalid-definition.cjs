// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function invalidDefinition({folder, api}) {
  // The invalid definition's tab shows its diagnostic, readable and located, never the runner's JSON.
  await vscode.commands.executeCommand('projections.openProjection', folder, 'legacy')
  const failure = await until('the failed projection tab', async () => {
    const found = await api.control('legacy', {op: 'elements', selector: '.projection-failure'})
    return found.length ? found[0].text : undefined
  })
  assert.match(failure, /legacy can't load/u)
  assert.match(failure, /\.github\/projections\/legacy\.json:7: Module comparators were removed/u)
  assert.ok(!failure.includes('{"'), failure)
}
