// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')
const {execFileSync} = require('node:child_process')
const os = require('node:os')
const {control, until, elements} = require('../helpers.cjs')

module.exports = async function documents({folder}) {
  // A saved extraction opens as it was saved, through serve --stdio --document; nothing runs.
  const saved = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'projections-artifact-')), 'packages.extraction.json')
  await fs.writeFile(saved, execFileSync(process.env.PROJECTIONS_CLI, ['show', '-p', 'packages', '--json'], {cwd: folder.fsPath}))
  await vscode.commands.executeCommand('projections.openArtifact', vscode.Uri.file(saved))
  const artifact = await until('the saved extraction', async () => {
    const summary = await control({op: 'summary'}, 'document')
    return summary.source === 'artifact' && summary.items?.length ? summary : undefined
  })
  assert.ok(
    artifact.items.some(item => item.id === 'workspace:@demo/auth'),
    JSON.stringify(artifact.items),
  )
  assert.equal(artifact.executionAuthorized, false)

  // A renderer package's scenarios (serve --stdio --fixtures), its bundle relayed into the webview and a scenario's
  // rules comparator run in the webview.
  await vscode.commands.executeCommand(
    'projections.openScenarios',
    vscode.Uri.file(path.resolve(__dirname, '../../../../../renderers/api')),
  )
  await until('the workbench', async () => (await elements('[data-fixtures-workbench]', undefined, 'fixtures')).length > 0)
  const scenario = '[data-scenario="api/dotnet-payments-compatibility"]'
  if (!(await elements('[data-scenario]', undefined, 'fixtures')).length)
    await control({op: 'click', selector: 'button[aria-label="Show explorer sidebar"]'}, 'fixtures')
  await until('the scenario', async () => (await elements(scenario, undefined, 'fixtures')).length > 0)
  await control({op: 'click', selector: `${scenario} button, button${scenario}`}, 'fixtures')
  await until(
    'the rules comparator in the workbench',
    async () => {
      const [comparator] = await elements('.pi-statusbar [data-comparator]', 'data-comparator', 'fixtures')
      const ready = await elements('.ph[data-mode="comparison"][data-renderer-status="ready"]', undefined, 'fixtures')
      return comparator?.value?.includes('api-compatibility.comparator.yaml') && ready.length > 0
    },
    90_000,
  )
}
