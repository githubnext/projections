// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function choices({folder, api, mergeBase, choiceName, swaps, summaryBar, shownSummary, projectionTabs}) {
  // A click on a Viewing row sets the choice. Current state shows the working tree alone: no comparison.
  const pickInTab = async (id, what, check) => {
    await api.viewingActivate(id)
    return until(what, check, 30_000)
  }
  // The status bar item's click opens the Viewing quick pick: the Viewing view's rows from the same item model, its
  // groups as separators, then Show in Side Bar. Picking Current state there checks its row and renames the item.
  {
    const bar = api.statusBar()
    const choosing = vscode.commands.executeCommand(bar.command, vscode.Uri.parse(bar.arguments[0]))
    const shown = await until('the Viewing quick pick', async () => api.pickItems() ?? undefined)
    assert.equal(shown.title, 'Viewing')
    // It opens on the current choice.
    assert.deepEqual(shown.active, ['$(check) Branch changes'])
    const listed = api
      .viewing()
      .rows.filter(row => row.kind !== 'group')
      .map(row => row.label)
    const picked = shown.items.filter(item => !item.startsWith('---')).map(item => item.replace(/^\$\([^)]+\) /, ''))
    assert.deepEqual(picked, [...listed, 'Show in Side Bar'])
    assert.deepEqual(shown.items.slice(0, 4), [
      '$(blank) Current state',
      '$(blank) Uncommitted changes',
      '$(check) Branch changes',
      '$(blank) Pull request…',
    ])
    assert.ok(shown.items.includes('--- Recent changes'), JSON.stringify(shown.items))
    assert.deepEqual(shown.items.slice(-4), ['---', '$(blank) Compare two revisions…', '---', '$(projections-mark) Show in Side Bar'])
    await api.pick('$(blank) Current state')
    await choosing
  }
  const now = await until(
    'the tab on Now',
    async () => {
      const summary = shownSummary()
      return summary?.status === 'ok' && summary.pair && !summary.pair.before && summary.pair.after === 'working-tree' ? summary : undefined
    },
    30_000,
  )
  assert.deepEqual(
    api
      .viewing()
      .rows.filter(row => row.checked)
      .map(row => row.id),
    ['now'],
  )
  assert.equal(now.comparison?.compared ?? false, false)
  // One revision: the summary bar shows totals only.
  const totalsBar = await until('the summary bar with totals', async () => {
    const sentence = await summaryBar()
    return /^\d+ workspaces? .*· \d+ dependenc(y|ies)/.test(sentence) && !/[+\u2212~]\d/.test(sentence) ? sentence : undefined
  })
  assert.ok(totalsBar)
  assert.equal(api.rows()[0].choice.id, 'now')
  await until('Current state in the control, without Swap', async () => (await choiceName()) === 'Current state' && (await swaps()) === 0)
  assert.equal(api.rows()[0].header, 'Current state · your files as they are now')
  await until('the row on Now', async () => api.rows()[0].projections[0].status === 'extracted')
  assert.equal(api.status(), '$(projections-mark) Current state')
  assert.match(api.statusBar().tooltip, /your files, as they are now/)
  // The item shows only where projections are in view: a projection tab in front, or a Projections view visible.
  {
    const textFile = vscode.Uri.joinPath(folder, 'package.json')
    const projectionInFront = () => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
      return input instanceof vscode.TabInputCustom && input.viewType === 'projections.projection'
    }
    await vscode.commands.executeCommand('workbench.action.closeSidebar')
    await vscode.window.showTextDocument(textFile, {preview: false})
    await until('the status bar item hidden in a text editor, the side bar closed', async () =>
      api.statusBar().visible ? undefined : true,
    )
    await vscode.commands.executeCommand('projections.openProjection', folder, 'packages')
    await until('the status bar item on a projection tab, the side bar closed', async () => (api.statusBar().visible ? true : undefined))
    await vscode.window.showTextDocument(textFile, {preview: false})
    await vscode.commands.executeCommand('workbench.view.extension.projections')
    await until('the status bar item with the side bar open, a text editor in front', async () =>
      api.statusBar().visible && !projectionInFront() ? true : undefined,
    )
    await vscode.commands.executeCommand('projections.openProjection', folder, 'packages')
    await until('the projection tab in front again', async () => (projectionInFront() ? true : undefined))
  }
  // The second item, Uncommitted: HEAD → the working tree.
  await pickInTab('uncommitted', 'the tab on Uncommitted', async () => {
    const summary = shownSummary()
    return summary?.comparison?.compared && summary.pair.before === 'HEAD' && summary.pair.after === 'working-tree'
  })
  await until(
    'Uncommitted changes in the control, without Swap',
    async () => (await choiceName()) === 'Uncommitted changes' && (await swaps()) === 0,
  )
  // D2: the pick is remembered for the repository, and a newly opened tab opens on it.
  const picked = api.rows()[0].choice
  assert.deepEqual([picked.id, picked.automatic, picked.remembered?.id], ['uncommitted', false, 'uncommitted'])
  await vscode.window.tabGroups.close(projectionTabs())
  await until('the projection tabs closed', async () => api.tabs('packages').length === 0)
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages')
  await until('a new tab on Uncommitted', async () => {
    const summary = shownSummary()
    return summary?.comparison?.compared && summary.pair.before === 'HEAD' && summary.pair.after === 'working-tree'
  })
  assert.equal(await until('the Viewing view on Uncommitted changes', choiceName), 'Uncommitted changes')
  // The status bar names it as the row does; its tooltip has the span and its size.
  assert.equal(api.status(), '$(projections-mark) Uncommitted changes')
  await until('the uncommitted files in the tooltip', async () =>
    /`[0-9a-f]{7}` → your files\n\n\d+ files? uncommitted · \d+ files? changed/.test(api.statusBar().tooltip) ? true : undefined,
  )
  // Back to My branch, by its identity.
  await vscode.commands.executeCommand('projections.setChoice', folder, 'branch')
  await until('the tab on My branch', async () => shownSummary()?.pair?.before === mergeBase)
}
