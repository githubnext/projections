// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function definitionEdits({folder, api}) {
  // A normal tab applies the committed definition while there are no edits. Once the definition has uncommitted edits,
  // the tab is out of date and Refresh applies them: "Your edits", with Show committed.
  assert.equal(api.tabs('packages')[0].summary.definitionRevision, 'HEAD')
  const definitionPath = path.join(folder.fsPath, '.github', 'projections', 'packages.json')
  const definitionOriginal = await fs.readFile(definitionPath, 'utf8')
  const editDefinition = title => fs.writeFile(definitionPath, `${JSON.stringify({...JSON.parse(definitionOriginal), title}, null, 2)}\n`)
  const editsMark = async () =>
    (await api.control('packages', {op: 'elements', selector: '[data-edits]', attribute: 'data-edits'}))[0]?.value
  const refreshPackages = () =>
    vscode.commands.executeCommand('projections.refreshProjection', {
      model: {folder: vscode.workspace.workspaceFolders[0]},
      definition: {id: 'packages'},
    })
  const tabApplies = (what, revision, after) =>
    until(what, async () => {
      const [shownTab] = api.tabs('packages')
      return (
        shownTab?.summary?.definitionRevision === revision &&
        (after === undefined || shownTab.jobs > after) &&
        Object.keys(shownTab.summary.results ?? {}).length === 2 &&
        shownTab.summary.comparison?.compared
      )
    })
  await editDefinition('Workspace packages')
  // The row keeps the committed title, as the tab does, and says it is edited.
  await until('the row edited', async () => api.rows()[0].projections[0].edited)
  assert.equal(api.rows()[0].projections[0].title, 'Packages')
  await until('the tab out of date for the edits', async () => api.tabs('packages')[0].stale ?? undefined)
  assert.match(
    await until(
      'the notice',
      async () => (await api.control('packages', {op: 'elements', selector: '[data-notice] [title]', attribute: 'title'}))[0]?.value,
    ),
    /Refresh applies your edits/,
  )
  // Until Refresh applies them, the results aren't the edits': no indicator.
  assert.equal(await editsMark(), undefined)
  let jobsBefore = api.tabs('packages')[0].jobs
  await refreshPackages()
  await tabApplies('the tab applying the edits', 'working-tree', jobsBefore)
  assert.equal(await until('"Your edits"', async () => ((await editsMark()) === 'yours' ? 'yours' : undefined)), 'yours')
  assert.match((await api.control('packages', {op: 'elements', selector: '.tp-edits'}))[0].text, /Your edits ·\s*Show committed/)
  assert.equal(api.tabs('packages')[0].stale, null)

  // Show committed: the committed definition, until the edits change again or Use my edits. (The Inspector keeps
  // extractions by the definition they applied, so switching back and forth may extract nothing.)
  await api.control('packages', {op: 'click', selector: '.tp-edits button', text: 'Show committed'})
  await tabApplies('the tab on the committed version', 'HEAD')
  assert.equal(await until('"Committed version"', async () => ((await editsMark()) === 'committed' ? 'committed' : undefined)), 'committed')
  assert.match((await api.control('packages', {op: 'elements', selector: '.tp-edits'}))[0].text, /Committed version ·\s*Use my edits/)
  // Remembered with the tab's state: reloaded as with the window, it comes back on the committed version.
  api.reload('packages')
  await until('the reloaded tab on the committed version', async () => {
    const [shownTab] = api.tabs('packages')
    return shownTab?.summary?.definitionRevision === 'HEAD' && shownTab.summary.comparison?.compared && (await editsMark()) === 'committed'
  })
  await api.control('packages', {op: 'click', selector: '.tp-edits button', text: 'Use my edits'})
  await tabApplies('the tab back on the edits', 'working-tree')
  assert.equal(await until('"Your edits" again', async () => ((await editsMark()) === 'yours' ? 'yours' : undefined)), 'yours')

  // Edits that change again end Show committed: the tab is out of date, and Refresh applies them.
  await api.control('packages', {op: 'click', selector: '.tp-edits button', text: 'Show committed'})
  await tabApplies('the committed version again', 'HEAD')
  await editDefinition('Workspace packages, again')
  await until('the tab out of date for the new edits', async () => api.tabs('packages')[0].stale ?? undefined)
  jobsBefore = api.tabs('packages')[0].jobs
  await refreshPackages()
  await tabApplies('the tab applying the new edits', 'working-tree', jobsBefore)
  assert.equal(await until('"Your edits" after the change', async () => ((await editsMark()) === 'yours' ? 'yours' : undefined)), 'yours')

  // Discarded, there are no edits: out of date, and Refresh returns the tab to the committed definition.
  await fs.writeFile(definitionPath, definitionOriginal)
  await until('the edits gone', async () => (await editsMark()) === undefined && !api.rows()[0].projections[0].edited)
  await until('the tab out of date for the discarded edits', async () => api.tabs('packages')[0].stale ?? undefined)
  jobsBefore = api.tabs('packages')[0].jobs
  await refreshPackages()
  await tabApplies('the tab back on the committed definition', 'HEAD', jobsBefore)
}
