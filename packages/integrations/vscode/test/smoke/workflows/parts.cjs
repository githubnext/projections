// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function parts({folder, api}) {
  // A part's Open Definition Entry (the Definition view's context menu) opens the definition with its entry
  // selected. Configure… on an absent one (the default comparator) only offers a choice: looking changes nothing,
  // so the file stays valid JSON.
  await vscode.commands.executeCommand('projections.openPart', folder, 'packages', 'extractor')
  // The definition's editor, wherever it opened: `activeTextEditor` can lag behind a webview tab's group.
  const definitionEditor = () =>
    vscode.window.visibleTextEditors.find(editor => /\/projections\/packages\.json$/.test(editor.document.uri.path))
  const definition = await until('the definition with the extractor selected', async () => {
    const editor = definitionEditor()
    return editor && !editor.selection.isEmpty ? editor : undefined
  })
  assert.equal(definition.document.getText(definition.selection), '"extractor": "workspace-dependencies"')
  const unchanged = definition.document.getText()
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages', {preview: false})
  await until('the Definition view on packages', async () => ((await api.definition()).projection === 'packages' ? true : undefined))
  const choosing = vscode.commands.executeCommand('projections.configureComparator')
  await until('the comparator choice', async () => api.picking())
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen')
  await choosing
  const comparator = definitionEditor()
  assert.equal(comparator.document.getText(), unchanged)
  assert.equal(comparator.document.isDirty, false)
}
