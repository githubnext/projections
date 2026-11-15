// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function schemas({folder}) {
  // A bad definition is reported from the bundled schema, with schema downloads off.
  const bad = vscode.Uri.joinPath(folder, '.github', 'projections', 'bad.json')
  await vscode.workspace.fs.writeFile(bad, Buffer.from('{"id": "bad", "extractor": 42}\n'))
  try {
    await vscode.window.showTextDocument(bad)
    const diagnostics = await until('the schema diagnostics', async () => {
      const found = vscode.languages.getDiagnostics(bad)
      return found.length ? found : undefined
    })
    const messages = diagnostics.map(diagnostic => diagnostic.message)
    assert.ok(
      messages.some(message => /renderer/.test(message)),
      messages.join(' | '),
    )
    assert.ok(!messages.some(message => /Unable to load schema|Downloading schemas is disabled/.test(message)), messages.join(' | '))
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await vscode.workspace.fs.delete(bad)
  }
}
