// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function newProjection({folder, api}) {
  // New Projection… (the + in the Projections section's title bar): from a built-in extractor and a renderer that
  // fits it, named, then written by projections init; its definition and tab open and its row is selected.
  const created = (await vscode.extensions.getExtension('githubnext.projections-vscode').activate()).newProjection
  const file = path.join(folder.fsPath, '.github', 'projections', 'package-map.json')
  const running = vscode.commands.executeCommand('projections.newProjection')
  if (!vscode.workspace.isTrusted) {
    // Restricted Mode: it says why and offers to manage trust, writing nothing.
    assert.equal(await running, undefined)
    assert.equal(api.pickItems(), null)
    await assert.rejects(fs.stat(file))
  } else {
    const first = await until('the New projection pick', async () =>
      api.pickItems()?.title === 'New projection' ? api.pickItems() : undefined,
    )
    assert.deepEqual(first.items.slice(1), [
      '$(extensions) Start from a built-in extractor and renderer',
      '$(code) Write a custom extractor, renderer or comparator',
      '$(sparkle) Ask an agent to write it',
    ])
    await api.pick('$(extensions) Start from a built-in extractor and renderer')
    const extractors = await until('the extractor pick', async () =>
      api.pickItems()?.title === 'New projection: extractor' ? api.pickItems() : undefined,
    )
    assert.ok(extractors.items.includes('Workspace dependencies'), extractors.items.join())
    await api.pick('Workspace dependencies')
    const renderers = await until('the renderer pick', async () =>
      api.pickItems()?.title === 'New projection: renderer' ? api.pickItems() : undefined,
    )
    // The extractor's default first; only renderers that present graph/v0.
    assert.equal(renderers.items[0], 'Graph')
    assert.ok(renderers.items.includes('File packing'), renderers.items.join())
    assert.ok(!renderers.items.includes('Database'), renderers.items.join())
    await api.pick('File packing')
    const id = await until('the ID box', async () => (created.input()?.title === 'New projection: ID' ? created.input() : undefined))
    assert.equal(id.value, 'workspace-dependencies')
    // An ID the repository has is refused in place.
    await created.answer('packages')
    await until('the ID refused', async () => /already exists/.test(created.input()?.validation ?? '') || undefined)
    await created.answer('package-map')
    await until('the title box', async () => (created.input()?.title === 'New projection: title' ? true : undefined))
    await created.answer('Package map')
    const plan = await running
    assert.equal(plan.id, 'package-map')
    const definition = JSON.parse(await fs.readFile(file, 'utf8'))
    assert.deepEqual(
      [definition.id, definition.title, definition.extractor, definition.renderer],
      ['package-map', 'Package map', 'workspace-dependencies', 'file-packing'],
    )
    await until('the package-map tab', async () => api.tabs('package-map').length > 0 || undefined)
    assert.ok(
      vscode.window.tabGroups.all.some(group =>
        group.tabs.some(
          // As URIs: VS Code spells a Windows drive letter in lowercase, a joined path doesn't.
          tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === vscode.Uri.file(file).toString(),
        ),
      ),
      'the definition is open',
    )
    await until('the package-map row selected', async () => created.selected().includes('package-map') || undefined)
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await fs.rm(file)
    await api.refresh()
  }
}
