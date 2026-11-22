// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function rulesLanguage({folder}) {
  // Comparator files, from the shipped rules interpreter: the CEL highlighted by what each name is, a deliberate
  // error reported at its line and column as you type, hovers with signatures and completions in context.
  const rulesFile = vscode.Uri.joinPath(folder, 'tools', 'first.comparator.yaml')
  const rulesDocument = await vscode.workspace.openTextDocument(rulesFile)
  const rulesEditor = await vscode.window.showTextDocument(rulesDocument)
  const legend = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', rulesFile)
  const semantic = await until('semantic tokens in the rules file', async () => {
    const found = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', rulesFile)
    return found?.data?.length ? found : undefined
  })
  const decoded = []
  for (let index = 0, line = 0, character = 0; index < semantic.data.length; index += 5) {
    character = semantic.data[index] === 0 ? character + semantic.data[index + 1] : semantic.data[index + 1]
    line += semantic.data[index]
    decoded.push({line, character, length: semantic.data[index + 2], type: legend.tokenTypes[semantic.data[index + 3]]})
  }
  const rulesLines = rulesDocument.getText().split('\n')
  const rankLine = rulesLines.findIndex(text => text.includes('lists.range('))
  const columnOf = text => rulesLines[rankLine].indexOf(text)
  const tokenAt = text => decoded.find(token => token.line === rankLine && token.character === columnOf(text))?.type
  assert.deepEqual(['lists', 'range', 'size', 'variables', 'priority', 'filter', 'change'].map(tokenAt), [
    'namespace',
    'function',
    'function',
    'namespace',
    'variable',
    'macro',
    'parameter',
  ])
  // Keys, comments and prose aren't CEL.
  const formatLine = rulesLines.findIndex(text => text.startsWith('format:'))
  assert.ok(
    decoded.every(token => token.line > formatLine + 2),
    JSON.stringify(decoded.slice(0, 3)),
  )
  const hovers = await vscode.commands.executeCommand(
    'vscode.executeHoverProvider',
    rulesFile,
    new vscode.Position(rankLine, columnOf('range(') + 1),
  )
  const hoverText = hovers.flatMap(hover => hover.contents.map(content => content.value ?? String(content))).join('\n')
  assert.match(hoverText, /lists\.range\(n: int\) -> list<int>/)
  const completions = await vscode.commands.executeCommand(
    'vscode.executeCompletionItemProvider',
    rulesFile,
    new vscode.Position(rankLine, columnOf('variables.') + 'variables.'.length),
  )
  assert.ok(
    completions.items.some(item => (item.label.label ?? item.label) === 'priority'),
    completions.items.map(item => item.label.label ?? item.label).join(),
  )
  await rulesEditor.edit(edit =>
    edit.replace(new vscode.Range(rankLine, columnOf('lists.range'), rankLine, columnOf('lists.range') + 11), 'lists.rnge'),
  )
  const rulesProblem = await until('the deliberate error', async () =>
    vscode.languages.getDiagnostics(rulesFile).find(item => item.source === 'projections rules'),
  )
  assert.match(rulesProblem.message, /^Undeclared function \x60lists\.rnge\x60/)
  assert.equal(rulesProblem.severity, vscode.DiagnosticSeverity.Error)
  assert.deepEqual(
    [rulesProblem.range.start.line, rulesProblem.range.start.character, rulesProblem.range.end.character],
    [rankLine, columnOf('lists.range') + 6, columnOf('lists.range') + 10],
  )
  await vscode.commands.executeCommand('workbench.action.files.revert')
  await until('the error cleared', async () =>
    vscode.languages.getDiagnostics(rulesFile).some(item => item.source === 'projections rules') ? undefined : true,
  )
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
}
