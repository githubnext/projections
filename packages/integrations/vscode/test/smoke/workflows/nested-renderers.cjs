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
    if (renderer === 'graph' && html) nest(html)
    report()
  })
  // Runs the built-in document nested, as embedRenderer does: its fragment set by a script with the document's nonce.
  let nested = 'loading'
  function nest(html) {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    const inner = 'nested-channel-0123456789'
    addEventListener('message', event => {
      if (event.source === frame.contentWindow && event.data?.channel === inner && event.data.type === 'ready') {
        nested = 'ready'
        report()
      }
    })
    const nonce = /<script[^>]*\\snonce="([^"]+)"/i.exec(html)?.[1]
    const script = '<script nonce="' + nonce + '">location.hash = "channel=' + inner + '&origin=null"</' + 'script>'
    frame.srcdoc = html.replace(/<head>/i, '<head>' + script)
    document.body.append(frame)
  }
  function report() {
    if (Object.keys(answers).length === names.length)
      post({type: 'error', message: 'documents ' + names.map(name => name + '=' + answers[name]).join('; ') + '; nested graph ' + nested})
  }
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
    /documents graph=html with nonce; nesting=refused \(nesting is not a built-in renderer\); no-such-renderer=refused \(no-such-renderer is not a built-in renderer\)/u,
  )
  // The built-in document runs nested under the webview's nonce policy, and speaks the protocol to its nesting frame.
  await until(
    'the nested graph renderer ready',
    async () =>
      (await api.control('nesting', {op: 'elements', selector: '.phv-notice'})).some(notice => notice.text.includes('nested graph ready')),
    30_000,
  )
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')

  // A renderer gallery: committed scenarios, drawn by the built-in gallery with the graph renderer nested, without trust.
  const graph = ids => ({
    protocolVersion: 0,
    schema: 'graph/v0',
    relationships: [],
    entities: ids.map(id => ({id, kind: 'service', label: id})),
  })
  const scenarios = {
    format: 'projections.scenarios',
    version: 0,
    title: 'Services',
    renderer: 'graph',
    scenarios: [{id: 'split', title: 'Billing splits', before: graph(['billing']), after: graph(['payments', 'fraud'])}],
  }
  await fs.writeFile(path.join(folder.fsPath, 'scenarios.json'), `${JSON.stringify(scenarios, null, 2)}\n`)
  const gallery = {id: 'gallery', title: 'Gallery', extractor: 'renderer-scenarios', renderer: 'gallery'}
  await fs.writeFile(path.join(folder.fsPath, '.github', 'projections', 'gallery.json'), `${JSON.stringify(gallery, null, 2)}\n`)
  await git(folder.fsPath, 'add', 'scenarios.json', '.github/projections/gallery.json')
  await git(folder.fsPath, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Gallery')
  await until('the gallery row', async () => api.rows()[0].projections.some(row => row.id === 'gallery'))
  await vscode.commands.executeCommand('projections.openProjection', folder, 'gallery', {preview: false})
  await until(
    'the gallery ready',
    async () => (await api.control('gallery', {op: 'elements', selector: '.phv-root[data-renderer-status="ready"]'})).length > 0,
    90_000,
  )
  const [frame] = await api.control('gallery', {op: 'elements', selector: 'iframe.ph-frame', attribute: 'aria-label'})
  assert.match(frame?.value ?? '', /Gallery/u)
  assert.equal((await api.control('gallery', {op: 'elements', selector: '.phv-notice[data-severity="warning"]'})).length, 0)
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
}
