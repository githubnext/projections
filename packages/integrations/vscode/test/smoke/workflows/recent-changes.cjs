// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function recentChanges({folder, api, choiceName, short}) {
  // Viewing's Recent changes: Find Recent Changes checks the last commits with every projection and lists the ones
  // that change any, each named by its subject with its short commit (what it changes is in its tooltip). A click
  // makes it the repository's choice: the status bar names it by its subject and the open tab shows it.
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages', {preview: false})
  await vscode.commands.executeCommand('projections.findRecentChanges')
  const found = await until(
    'the recent commits that change a projection',
    async () => {
      const rows = api.viewing().rows
      return rows.some(row => row.kind === 'progress') ? undefined : rows.find(row => row.kind === 'recent')
    },
    120_000,
  )
  assert.ok(api.viewingFinds() >= 1)
  assert.match(found.description, /^[0-9a-f]{7}$/u)
  assert.match(found.tooltip, /Changes Packages \\\(\d+ changes?\\\)/u)
  assert.match(found.contextValue, /\bbookmarkable\b/u)
  await api.viewingActivate(found.id)
  const [before, after] = found.id.replace(/^recent:/u, '').split('..')
  await until('the status bar on the commit', async () => ((await choiceName()) === short(found.label) ? true : undefined))
  assert.match(api.rows()[0].choice.id, /^pair:/u)
  await until('the tab on the commit', async () => {
    const summary = api.tabs('packages')[0]?.summary
    return summary?.pair?.before === before && summary.pair.after === after ? true : undefined
  })
  assert.deepEqual(
    api
      .viewing()
      .rows.filter(row => row.checked)
      .map(row => row.id),
    [found.id],
  )
  // Bookmark is inline: the commit is written to .projections-bookmarks.json and listed under Bookmarks; a click on
  // it sets the choice (the status bar names it); Remove undoes it.
  await api.viewingActivate(found.id, 'bookmark')
  const bookmarksPath = path.join(folder.fsPath, '.projections-bookmarks.json')
  const bookmark = await until('the bookmark', async () => api.viewing().rows.find(row => row.id.startsWith('bookmark:')))
  assert.equal(bookmark.label, `Bookmark: ${found.label}`)
  assert.equal(bookmark.description, found.description)
  assert.ok(api.viewing().rows.some(row => row.kind === 'group' && row.label === 'Bookmarks'))
  assert.ok(JSON.parse(await fs.readFile(bookmarksPath, 'utf8')).bookmarks.some(item => item.projectionId === 'packages'))
  await api.viewingActivate(bookmark.id)
  await until('the status bar on the bookmark', async () =>
    (await choiceName()) === short(bookmark.label.replace(/^Bookmark: /u, '')) ? true : undefined,
  )
  assert.match(api.statusBar().tooltip, /^\*\*Bookmark: /u)
  await api.viewingActivate(bookmark.id, 'remove')
  await until('the bookmark removed', async () => (api.viewing().rows.some(row => row.id.startsWith('bookmark:')) ? undefined : true))
  await fs.rm(bookmarksPath, {force: true})
  // A renderer's scenarios.json is a child of the Definition view's Renderer row.
  await until('the Definition view on packages', async () => ((await api.definition()).projection === 'packages' ? true : undefined))
  const shown = await api.definition()
  const renderer = shown.rows.find(item => item.kind === 'renderer')
  await fs.mkdir(path.join(folder.fsPath, 'scenario-demo'), {recursive: true})
  await fs.appendFile(path.join(folder.fsPath, '.git', 'info', 'exclude'), '\nscenario-demo/\n')
  await fs.writeFile(
    path.join(folder.fsPath, 'scenario-demo', 'scenarios.json'),
    JSON.stringify({
      format: 'projections.scenarios',
      version: 0,
      title: 'Demo',
      renderer: renderer.description,
      scenarios: [{id: 'one', title: 'One'}],
    }),
  )
  await until('the renderer scenarios', async () => {
    const row = (await api.definition()).rows.find(item => item.kind === 'renderer')
    return (
      row.children.some(item => item.kind === 'scenarios' && item.description === '1 scenario' && /scenario-demo/u.test(item.tooltip)) ||
      undefined
    )
  })
  await fs.rm(path.join(folder.fsPath, 'scenario-demo'), {recursive: true})
  // Back to My branch for what follows.
  await vscode.commands.executeCommand('projections.setChoice', folder, 'branch')
  await until('My branch again', async () => (api.rows()[0].choice.id === 'branch' ? true : undefined))
}
