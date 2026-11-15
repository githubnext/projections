// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')

module.exports = async function agentTools({folder, api, invoke}) {
  // Agent tools: VS Code's agent calls the CLI's tools on the folder's backend.
  const names = vscode.lm.tools.filter(tool => tool.name.startsWith('projections_')).map(tool => tool.name)
  for (const name of ['projections_list_projections', 'projections_compare', 'projections_open_projection', 'projections_set_part'])
    assert.ok(names.includes(name), names.join())
  assert.match(await invoke('projections_list_projections', {}), /- packages: Packages\. Extractor workspace-dependencies/)
  const compared = await invoke('projections_compare', {projection: 'packages', before: 'main', after: 'HEAD'})
  assert.match(compared, /\d+ changes in \d+ steps?: /)
  const entity = /Added entity [^\n]*\[([^\]]*auth)\]$/m.exec(compared)?.[1]
  assert.ok(entity, compared)
  // The editor action: the projection's tab, pinned to the pair, with the entity selected.
  const opened = await invoke('projections_open_projection', {projection: 'packages', before: 'main', after: 'HEAD', entity, pin: true})
  assert.match(opened, new RegExp(`on main → HEAD, pinned to its tab, with ${entity} selected`))
  assert.deepEqual(api.tabs('packages').at(-1).pinned, {before: 'main', after: 'HEAD'})
  // A write previews in its confirmation, and writes nothing until the person approves it.
  const tools = (await vscode.extensions.getExtension('githubnext.projections-vscode').activate()).agentTools
  const file = path.join(folder.fsPath, '.github', 'projections', 'packages.json')
  const original = await fs.readFile(file, 'utf8')
  const prepared = await tools.prepare('projections_set_part', {projection: 'packages', renderer: 'dag'})
  assert.match(prepared.invocationMessage, /packages/)
  assert.equal(await fs.readFile(file, 'utf8'), original)
  if (vscode.workspace.isTrusted) {
    assert.match(prepared.confirmation.message, /\+ {3}"renderer": "dag"/)
    // Approved: the write is the preview's.
    assert.match(await tools.invoke('projections_set_part', {projection: 'packages', renderer: 'dag'}), /^Saved the renderer of packages/)
    assert.match(await fs.readFile(file, 'utf8'), /"renderer": "dag"/)
    await fs.writeFile(file, original)
  } else {
    assert.equal(prepared.confirmation, undefined)
    assert.match(await tools.invoke('projections_set_part', {projection: 'packages', renderer: 'dag'}), /trusted workspace/)
    assert.equal(await fs.readFile(file, 'utf8'), original)
  }
}
