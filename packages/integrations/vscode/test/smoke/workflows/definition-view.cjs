// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function definitionView({folder, api, manifest}) {
  // The Definition view follows the active projection tab, as Outline follows the active editor: the one section that
  // does. Its title stays "Definition" (the tab names the projection); its rows are the definition file, then each
  // part with its value as a short fact. Provenance isn't a row (it is the tab's badge when unusual).
  const definitionOn = projection =>
    until(`the Definition view on ${projection}`, async () => {
      const shown = await api.definition()
      return shown.projection === projection && shown.rows.length ? shown : undefined
    })
  const shown = await definitionOn('packages')
  const staticTitle = title => [null, 'Definition'].includes(title)
  assert.ok(staticTitle(shown.title), shown.title)
  assert.equal(shown.message, null)
  assert.equal(manifest.views.projections.find(view => view.id === 'projections.definition').name, 'Definition')
  const parts = shown.rows.filter(item => ['extractor', 'comparator', 'renderer'].includes(item.kind))
  assert.deepEqual(
    parts.map(item => [item.label, item.contextValue]),
    [
      ['Extractor', 'definition-extractor docs'],
      ['Comparator', 'definition-comparator docs'],
      ['Renderer', 'definition-renderer docs'],
    ],
  )
  assert.deepEqual(
    parts.slice(0, 2).map(item => item.description),
    ['workspace-dependencies', 'default'],
  )
  assert.deepEqual(
    shown.rows.map(item => item.kind),
    ['definition', 'extractor', 'comparator', 'renderer'],
  )
  assert.equal(shown.rows[0].label, 'packages.json')
  assert.match(shown.rows[0].tooltip, /\.github\/projections\/packages\.json/u)
  // Another projection's tab: the view moves to it, its title unchanged; back again, it follows.
  await vscode.commands.executeCommand('projections.openProjection', folder, 'legacy')
  assert.ok(staticTitle((await definitionOn('legacy')).title))
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages', {preview: false})
  assert.ok(staticTitle((await definitionOn('packages')).title))
  // Pinned, it stays on its projection whatever tab is active, and its message names it (the pin is the one state
  // the tab doesn't show); unpinned, it follows again.
  await vscode.commands.executeCommand('projections.definition.pin')
  await vscode.commands.executeCommand('projections.openProjection', folder, 'legacy')
  await until('the legacy tab active', async () =>
    /legacy/u.test(String(vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri ?? '')) ? true : undefined,
  )
  const pinned = await api.definition()
  assert.deepEqual([pinned.projection, pinned.pinned, pinned.message], ['packages', true, 'Pinned to Packages'])
  assert.ok(staticTitle(pinned.title), pinned.title)
  await vscode.commands.executeCommand('projections.definition.unpin')
  assert.equal((await definitionOn('legacy')).message, null)
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages', {preview: false})
  await definitionOn('packages')
  // The definition row opens the file; the view stays on the projection while its own file is the active editor.
  await api.definitionActivate('definition')
  await until(
    'the definition open',
    async () =>
      vscode.window.visibleTextEditors.some(editor => /\/projections\/packages\.json$/u.test(editor.document.uri.path)) || undefined,
  )
  assert.equal((await api.definition()).projection, 'packages')
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages', {preview: false})
  await definitionOn('packages')
  // Selecting a row never leaves VS Code: a built-in part's row opens its bundled documentation (the extension's own
  // dist/docs files) in the Markdown preview, and the view stays on the projection while it is open. Its page on
  // GitHub is only the explicit Open Documentation on GitHub (inline and in the context menu), never a click.
  const externalBefore = api.docs().externalOpens
  const docsPreview = page =>
    until(`the ${page} documentation in the Markdown preview`, async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      return tab?.input instanceof vscode.TabInputCustom &&
        tab.input.viewType === 'vscode.markdown.preview.editor' &&
        tab.input.uri.scheme === 'file' &&
        tab.input.uri.path.endsWith(`/dist/docs/${page}`)
        ? tab
        : undefined
    })
  const docsRows = (await api.definition()).rows.filter(item => /docs$/u.test(item.contextValue ?? ''))
  assert.deepEqual(
    docsRows.map(item => [item.label, item.command.command, item.command.arguments]),
    [
      ['Extractor', 'projections.openDocumentation', ['extractors/workspace-dependencies.md']],
      ['Comparator', 'projections.openDocumentation', ['comparators/default.md']],
      ['Renderer', 'projections.openDocumentation', ['renderers/graph.md']],
    ],
  )
  for (const row of docsRows) assert.match(row.tooltip, /click to read its documentation here in VS Code/u)
  await api.definitionActivate('renderer')
  await docsPreview('renderers/graph.md')
  assert.ok(api.docs().reads.includes('renderers/graph.md'), JSON.stringify(api.docs().reads))
  assert.equal((await api.definition()).projection, 'packages')
  // The default comparator's row reads its docs too; its gear stays Configure….
  await api.definitionActivate('comparator')
  await docsPreview('comparators/default.md')
  assert.equal((await api.definition()).projection, 'packages')
  const itemMenus = manifest.menus['view/item/context']
  assert.ok(
    itemMenus.some(
      item => item.command === 'projections.configureComparator' && item.group === 'inline' && /definition-comparator/u.test(item.when),
    ),
  )
  const github = itemMenus.filter(item => item.command === 'projections.openDocumentationOnGitHub')
  assert.deepEqual(github.map(item => item.group).toSorted(), ['inline@9', 'navigation@3'])
  assert.equal(manifest.commands.find(item => item.command === 'projections.openDocumentationOnGitHub').icon, '$(link-external)')
  const previews = () =>
    vscode.window.tabGroups.all.flatMap(group =>
      group.tabs.filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'vscode.markdown.preview.editor'),
    )
  await vscode.window.tabGroups.close(previews())
  // Go to Source…'s built-in item (the same model): its docs in the preview beside the tab, never the browser.
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages', {preview: false})
  await definitionOn('packages')
  await api.openSource('packages', 'workspace-dependencies (built-in)')
  const sourceDocs = await docsPreview('extractors/workspace-dependencies.md')
  assert.ok(api.docs().reads.includes('extractors/workspace-dependencies.md'))
  assert.ok(
    vscode.window.tabGroups.all.some(group =>
      group.tabs.some(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'projections.projection'),
    ),
  )
  assert.equal(api.docs().externalOpens, externalBefore)
  assert.ok(previews().includes(sourceDocs))
  await vscode.window.tabGroups.close(previews())
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages', {preview: false})
  await definitionOn('packages')
  // The extractions shown, in the Projections output channel.
  await vscode.commands.executeCommand('projections.showExtractionOutput')
  // Go to Source… (the projection tab's title button): the files behind it. Built-ins leave only the definition,
  // which opens directly, to the side; the parts are their docs and Configure….
  const title = vscode.extensions.getExtension('githubnext.projections-vscode').packageJSON.contributes.menus['editor/title']
  assert.ok(title.some(item => item.command === 'projections.goToSource' && item.group.startsWith('navigation')))
  await vscode.commands.executeCommand('projections.goToSource')
  assert.deepEqual(
    api.sources().map(item => item.split(': ')[0]),
    ['Definition', 'Extractor', 'Comparator', 'Renderer'],
  )
  assert.match(api.sources()[2], /Default · Configure…$/u)
  const beside = await until('the definition beside the tab', async () =>
    vscode.window.visibleTextEditors.find(editor => /\/projections\/packages\.json$/u.test(editor.document.uri.path)),
  )
  // Beside the projection tab, not over it: the tab stays open.
  assert.ok(
    vscode.window.tabGroups.all.some(group =>
      group.tabs.some(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'projections.projection'),
    ),
  )
  await vscode.window.showTextDocument(beside.document, beside.viewColumn)
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages', {preview: false})
  await definitionOn('packages')
}
