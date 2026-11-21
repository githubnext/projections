// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {control, until, elements} = require('../helpers.cjs')

module.exports = async function inspector({folder}) {
  // The Inspector: the repository's own projection only, compared in the webview's engine Worker.
  await vscode.commands.executeCommand('projections.openInspector')
  const listed = await until('the projection list', async () => {
    const summary = await control({op: 'summary'})
    return summary.projections.length ? summary : undefined
  })
  assert.deepEqual(listed.projections, [{id: 'packages', title: 'Packages'}])
  // A built-in extractor runs without trust; the comparison is computed in the webview's engine Worker.
  await control({op: 'setPair', before: 'main', after: 'HEAD'})
  const compared = await until('the comparison', async () => {
    const summary = await control({op: 'summary'})
    return summary.comparison?.compared && summary.pair.before === 'main' ? summary : undefined
  })
  assert.equal(compared.status, 'ok')
  assert.ok(compared.comparison.changes.added >= 2, JSON.stringify(compared.comparison))
  assert.equal(await control({op: 'selectEntity', entity: 'no-such-entity'}), false)

  // The Comparator part offers the repository's comparator files (GET /api/definitions' rules) and runs the one chosen
  // (GET /api/comparator?rules=) in the webview's sandbox.
  if (!(await elements('[data-part="comparator"]')).length) {
    await control({op: 'click', selector: 'button[aria-label="Show explorer sidebar"]'})
  }
  const trigger = '[data-part="comparator"] [aria-label="Comparator"]'
  await until('the comparator part', async () => (await elements(trigger)).length > 0)
  await control({op: 'click', selector: trigger})
  const options = await until('the comparator options', async () => {
    const found = await elements('[role="option"]')
    return found.length ? found.map(option => option.text) : undefined
  })
  assert.ok(
    options.some(text => text.includes('first') && text.includes('tools/first.comparator.yaml')),
    options.join(' | '),
  )
  // A Radix select item is chosen by keyboard (the first pointer release after opening is the opening press's).
  await control({op: 'press', selector: '[role="option"]', text: 'tools/first.comparator.yaml', key: 'Enter'})
  const ruled = await until('the rules comparison', async () => {
    const [comparator] = await elements('.pi-statusbar [data-comparator]', 'data-comparator')
    const summary = await control({op: 'summary'})
    return comparator?.value?.includes('first.comparator.yaml') && summary.comparison?.compared ? summary : undefined
  })
  assert.equal(ruled.status, 'ok')
  assert.ok(ruled.comparison.changes.added >= 2, JSON.stringify(ruled.comparison))
  await control({op: 'click', selector: '[data-part="comparator"] button[aria-label^="Reset the comparator"]'})
  await until('the default comparison again', async () => {
    const [comparator] = await elements('.pi-statusbar [data-comparator]', 'data-comparator')
    return comparator?.value === 'default' && (await control({op: 'summary'})).comparison?.compared
  })

  // Evidence opens the file at its line.
  const item = compared.items.find(row => row.kind !== 'relationship' && /auth/.test(row.label)) ?? compared.items[0]
  assert.equal(await control({op: 'selectEntity', entity: item.id}), true)
  // The selection's evidence is in the docked Details panel.
  if ((await elements('button[aria-label="Show details panel"]')).length) {
    await control({op: 'click', selector: 'button[aria-label="Show details panel"]'})
  }
  const evidence = '.ph-evidence button, .phv-evidence-link'
  await until(
    'the evidence',
    async () => (await elements(evidence)).length > 0,
    undefined,
    async () => ({
      item,
      evidence: await elements('.ph-detail-evidence li, .ph-detail-evidence'),
      details: await elements('button[aria-label$="details panel"]', 'aria-label'),
    }),
  )
  await control({op: 'click', selector: evidence})
  const editor = await until('the evidence file', async () =>
    vscode.window.visibleTextEditors.find(
      editor => editor.document.uri.fsPath.startsWith(folder.fsPath) && editor.document.uri.fsPath.endsWith('package.json'),
    ),
  )
  assert.ok(editor)
  // It opened beside the Inspector, in a second editor group: closed, so the workflows after this one open their tabs
  // in the one group (a group left behind can become the active one, and a projection opened there is a second tab).
  const evidenceTabs = () =>
    vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === editor.document.uri.toString())
  await vscode.window.tabGroups.close(evidenceTabs())
  await until('one editor group again', async () => (vscode.window.tabGroups.all.length === 1 ? true : undefined))

  await vscode.commands.executeCommand('projections.compareBranchWithDefault')
  const branch = await control({op: 'summary'})
  assert.equal(branch.pair.after, 'HEAD')
  assert.match(branch.pair.before, /^[0-9a-f]{40}$/)
}
