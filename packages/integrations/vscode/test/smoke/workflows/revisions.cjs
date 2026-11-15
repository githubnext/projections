// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function revisions({folder, api, choiceName, swaps, tabShows}) {
  // Revisions no choice names (Compare two revisions…) are two revisions: every tab that isn't pinned moves.
  await vscode.commands.executeCommand('projections.setPair', folder, {before: 'main', after: 'HEAD'})
  await tabShows('the tab on main → HEAD', summary => summary.pair.before === 'main' && summary.pair.after === 'HEAD')
  // The status bar names two revisions by their ref names for people (HEAD is its branch), with no counts.
  await until('the status bar on main → HEAD', async () => ((await choiceName()) === 'main → feature/auth' ? true : undefined))
  assert.match(api.statusBar().tooltip, /^\*\*main → feature\/auth\*\*\n\nmain `[0-9a-f]{7}` → feature\/auth `[0-9a-f]{7}`/)
  assert.deepEqual(api.rows()[0].pair, {before: 'main', after: 'HEAD'})
  assert.equal(api.rows()[0].choice.id, 'custom')
  assert.deepEqual(
    api
      .viewing()
      .rows.filter(row => row.checked)
      .map(row => [row.id, row.description]),
    [['compare', 'main → HEAD']],
  )
  // Two revisions are the one choice Swap reverses.
  await until('Swap on two revisions', async () => (await swaps()) === 1)
  // Swap, from the tab's title bar.
  await vscode.commands.executeCommand('projections.swapPair')
  await tabShows('the swapped tab', summary => summary.pair.before === 'HEAD' && summary.pair.after === 'main')
  // Back again: the Viewing view's inline Swap on Compare two revisions… is the same command.
  await vscode.commands.executeCommand('projections.swapPair', folder)
  await tabShows('the tab swapped back', summary => summary.pair.before === 'main' && summary.pair.after === 'HEAD')

  // The title bar's mode toggle moves the tab in front on to the next mode the renderer offers. Read that tab, not the
  // first Packages tab: another may be open in another editor group, and the command doesn't act on it.
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages', {preview: false})
  const inFront = () => api.tabs('packages').find(tab => tab.inFront)?.summary
  const modes = await until('the tab in front', async () => inFront()?.view)
  assert.ok(modes.modes?.length > 1, JSON.stringify(modes))
  const next = modes.modes[(modes.modes.indexOf(modes.mode) + 1) % modes.modes.length]
  await vscode.commands.executeCommand(`projections.mode.${modes.mode}`)
  await until(`the next mode, ${next}`, async () => (inFront()?.view?.mode === next ? true : undefined))

  // Compare All counts every projection on the folder's pair; the badge says how many changed.
  await vscode.commands.executeCommand('projections.compareAll', folder)
  await until('the badge', async () => (api.badge() >= 1 ? true : undefined))
  assert.match(api.rows()[0].projections[0].status, /^\d+ changes?$/)
  // D6: a row's Refresh re-extracts its open tab, which reports its count again.
  await vscode.commands.executeCommand('projections.refreshProjection', {
    model: {folder: vscode.workspace.workspaceFolders[0]},
    definition: {id: 'packages'},
  })
  await until('the refreshed row', async () => (/^\d+ changes?$/.test(api.rows()[0].projections[0].status) ? true : undefined))
}
