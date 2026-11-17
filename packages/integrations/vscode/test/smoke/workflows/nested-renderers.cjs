// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')
const {git, until} = require('../helpers.cjs')

/**
 * A custom renderer that asks the host for renderer documents by name and reports, as its `error`, what it got: the
 * built-in `graph` (as the webview runs it, with its script nonce), itself (custom) and a name no renderer has.
 */
const probe = `<!doctype html>
<html lang="en"><body><script>
  const channel = new URLSearchParams(location.hash.slice(1)).get('channel')
  const post = message => parent.postMessage({projections: 0, channel, ...message}, '*')
  const names = ['graph', 'nesting', 'no-such-renderer']
  const answers = {}
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.channel !== channel) return
    if (event.data.type === 'init') post({type: 'rendered', progress: 1})
    if (event.data.type !== 'document') return
    const {renderer, html, error} = event.data
    answers[renderer] = html !== undefined ? (/<script nonce=/.test(html) ? 'html with nonce' : 'html') : 'refused (' + error + ')'
    if (Object.keys(answers).length === names.length)
      post({type: 'error', message: 'documents ' + names.map(name => name + '=' + answers[name]).join('; ')})
  })
  post({type: 'ready', capabilities: {changeHighlighting: 'none', drawsRelationships: false}})
  for (const renderer of names) post({type: 'document-request', renderer})
</script></body></html>
`

module.exports = async function nestedRenderers({folder, api}) {
  // A committed projection whose custom renderer asks for renderer documents: the webview supplies built-in ones only.
  const bundle = path.join(folder.fsPath, '.github', 'projections', 'nesting', 'dist')
  await fs.mkdir(bundle, {recursive: true})
  await fs.writeFile(path.join(bundle, 'index.html'), probe)
  await fs.writeFile(
    path.join(bundle, 'renderer.json'),
    JSON.stringify({format: 'projections.renderer', version: 0, name: 'nesting', title: 'Documents probe', handles: []}),
  )
  const definition = {
    id: 'nesting',
    title: 'Nesting',
    extractor: 'workspace-dependencies',
    renderer: {bundle: '.github/projections/nesting/dist'},
  }
  await fs.writeFile(path.join(folder.fsPath, '.github', 'projections', 'nesting.json'), `${JSON.stringify(definition, null, 2)}\n`)
  await git(folder.fsPath, 'add', '.github/projections/nesting.json', '.github/projections/nesting')
  await git(folder.fsPath, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Nesting probe')
  await until('the nesting row', async () => api.rows()[0].projections.some(row => row.id === 'nesting'))
  await vscode.commands.executeCommand('projections.openProjection', folder, 'nesting', {preview: false})
  const report = await until(
    "the probe's report",
    async () => {
      const notices = await api.control('nesting', {op: 'elements', selector: '.phv-notice'})
      return notices.map(notice => notice.text).find(text => text.includes('documents '))
    },
    90_000,
  )
  assert.match(
    report,
    /documents graph=html with nonce; nesting=refused \(nesting is not a built-in renderer\); no-such-renderer=refused \(no-such-renderer is not a built-in renderer\)/,
  )
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
}
