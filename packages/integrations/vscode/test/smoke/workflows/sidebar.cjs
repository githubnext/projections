// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function sidebar({folder, api}) {
  // The Projections activity bar container: the repository's projection with its kind icon, and the definition using
  // the removed module comparator as a failed row with a Problems diagnostic at its field; neither hides the other.
  await vscode.commands.executeCommand('workbench.view.extension.projections')
  const [rows] = await until('the side bar rows', async () => {
    const found = api.rows()
    return found[0]?.loaded && found[0].invalid.length ? found : undefined
  })
  assert.deepEqual(
    rows.projections.map(row => [row.id, row.title, row.icon]),
    [['packages', 'Packages', 'package']],
  )
  // Rows are for viewing: a leaf (no chevron, no part children) that opens the projection; its parts are the
  // Definition view's. Scenarios moved there too (under Renderer): no Scenarios view.
  assert.deepEqual(
    [rows.projections[0].collapsible, rows.projections[0].contextValue],
    [vscode.TreeItemCollapsibleState.None, 'projection'],
  )
  {
    const contributed = vscode.extensions.getExtension('githubnext.projections-vscode').packageJSON.contributes
    // Four sections, each answering one question, in this order; Checks is the Testing view now.
    const ids = contributed.views.projections.map(view => view.id)
    assert.deepEqual(ids, ['projections.viewing', 'projections.projections', 'projections.definition', 'projections.suggested'])
    assert.deepEqual(
      contributed.views.projections.map(view => view.name),
      ['Viewing', 'Projections', 'Definition', 'Suggested'],
    )
    const commands = await vscode.commands.getCommands(true)
    for (const removed of ['projections.runChecks', 'projections.addPair', 'projections.showPair', 'projections.pairs.bookmark']) {
      assert.ok(!commands.includes(removed), removed)
    }
    // No "pair" in a command's title.
    assert.deepEqual(
      contributed.commands.filter(command => /\bpairs?\b/iu.test(command.title)).map(command => command.title),
      [],
    )
    // Add to CI… is in the Projections view's "…" menu (not its title's buttons), and nothing writes a workflow.
    assert.ok(!commands.includes('projections.publish'))
    assert.ok(
      contributed.menus['view/title'].some(
        item =>
          item.command === 'projections.addToCi' &&
          /view == projections\.projections/u.test(item.when) &&
          !item.group.startsWith('navigation'),
      ),
    )
    const rowMenu = contributed.menus['view/item/context']
      .filter(item => /viewItem == projection\b/u.test(item.when ?? ''))
      .map(item => item.command)
    assert.ok(rowMenu.includes('projections.openDefinition') && !rowMenu.includes('projections.develop'), rowMenu.join())
    // One tab type: no Develop tab, editor or command (developing is the side bar's collapsed sections).
    assert.ok(!(contributed.customEditors ?? []).some(editor => editor.viewType === 'projections.develop'))
    assert.ok(!(await vscode.commands.getCommands(true)).includes('projections.develop'))
    assert.ok(!JSON.stringify(contributed.menus).includes('openPartFile'))
  }
  assert.deepEqual(
    rows.invalid.map(row => [row.id, row.path, row.description]),
    [['legacy', '.github/projections/legacy.json', 'failed']],
  )
  assert.match(rows.invalid[0].messages[0], /^Module comparators were removed; name a comparator file instead/u)
  assert.ok(
    rows.candidates.some(candidate => candidate.id === 'repository-map' && /match/u.test(candidate.reason)),
    JSON.stringify(rows.candidates),
  )
  // Suggested: the candidates not adopted, each with Adopt inline.
  const suggested = await api.suggested()
  assert.ok(
    suggested.some(row => row.label && row.contextValue === 'candidate' && row.description === 'repository-map'),
    JSON.stringify(suggested),
  )
  const legacy = vscode.Uri.joinPath(folder, '.github', 'projections', 'legacy.json')
  const [problem] = await until('the definition problem', async () => {
    const found = vscode.languages.getDiagnostics(legacy).filter(diagnostic => diagnostic.source === 'projections')
    return found.length ? found : undefined
  })
  assert.equal(problem.range.start.line, 6)
  assert.match(problem.message, /Module comparators were removed/u)
}
