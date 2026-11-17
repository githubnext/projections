// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')
const {until, git: run} = require('../helpers.cjs')

module.exports = async function customRenderer({folder, tests, api}) {
  // A committed projection with a custom renderer bundle (the template's). A normal tab applies the committed
  // definition, `HEAD`; the bundle is read at the commit HEAD names, relayed into the webview and becomes ready.
  const cards = path.join(folder.fsPath, '.github', 'projections', 'cards')
  const minimal = path.resolve(__dirname, '../../../../../../examples/renderers/minimal/dist')
  await fs.mkdir(path.join(cards, 'dist'), {recursive: true})
  for (const name of ['index.html', 'renderer.json']) await fs.copyFile(path.join(minimal, name), path.join(cards, 'dist', name))
  const cardsDefinition = {
    id: 'cards',
    title: 'Package cards',
    extractor: 'workspace-dependencies',
    renderer: {bundle: '.github/projections/cards/dist'},
  }
  await fs.writeFile(`${cards}.json`, `${JSON.stringify(cardsDefinition, null, 2)}\n`)
  const git = (...args) => run(folder.fsPath, ...args)
  await git('add', '.github/projections/cards.json', '.github/projections/cards')
  await git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Package cards')
  await until('the cards row', async () => api.rows()[0].projections.some(row => row.id === 'cards'))
  await vscode.commands.executeCommand('projections.openProjection', folder, 'cards', {preview: false})
  await until(
    'the custom renderer ready with the committed definition',
    async () => {
      const summary = await api.control('cards', {op: 'summary'})
      if (summary.projection?.id !== 'cards' || summary.definitionRevision !== 'HEAD') return undefined
      return (await api.control('cards', {op: 'elements', selector: '.phv-root[data-renderer-status="ready"]'})).length > 0
    },
    90_000,
  )
  const [frame] = await api.control('cards', {op: 'elements', selector: 'iframe.ph-frame', attribute: 'aria-label'})
  assert.match(frame?.value ?? '', /Package cards/)
  assert.equal((await api.control('cards', {op: 'elements', selector: '.phv-root[data-renderer-status="failed"]'})).length, 0)
  // The Definition view follows the tab; its title stays "Definition" (the tab names the projection).
  await until('the Definition view on cards', async () => ((await api.definition()).projection === 'cards' ? true : undefined))
  // A projection in the Testing view as soon as it is defined.
  await until('cards in the Testing view', async () => tests.items().some(item => item.id.endsWith('|projection:cards')))

  // Its renderer is a package with a watch script: saving a source while its tab is open starts it, as a background
  // task, with no separate watch process. (Here a script that says what Vite's watch says.)
  await fs.writeFile(
    path.join(cards, 'package.json'),
    `${JSON.stringify({name: 'cards-renderer', private: true, type: 'module', scripts: {watch: 'node watch.mjs'}}, null, 2)}\n`,
  )
  await fs.mkdir(path.join(cards, 'node_modules'), {recursive: true})
  await fs.mkdir(path.join(cards, 'src'), {recursive: true})
  await fs.writeFile(
    path.join(cards, 'watch.mjs'),
    [
      "import {readFileSync, watch} from 'node:fs'",
      'const build = () => {',
      "  console.log('build started...')",
      "  if (readFileSync('src/main.tsx', 'utf8').includes('FAIL')) {",
      "    console.log('[vite:esbuild] Transform failed with 1 error:')",
      '    console.log(`${process.cwd()}/src/main.tsx:1:1: ERROR: The source says FAIL`)',
      "  } else console.log('built in 5ms.')",
      '}',
      'build()',
      "watch('src', () => build())",
      '',
    ].join('\n'),
  )
  const source = path.join(cards, 'src', 'main.tsx')
  await fs.writeFile(source, 'export const cards = 1\n')
  const sourceDocument = await vscode.workspace.openTextDocument(source)
  const saveSource = async text => {
    const editor = await vscode.window.showTextDocument(sourceDocument, {preview: false, viewColumn: vscode.ViewColumn.Beside})
    await editor.edit(edit => edit.replace(new vscode.Range(0, 0, editor.document.lineCount, 0), text))
    await sourceDocument.save()
  }
  const cardsBuild = () => api.rendererBuilds().find(item => item.projection === 'cards')
  const rendererRow = async () => (await api.definition()).rows.find(row => row.kind === 'renderer')
  await saveSource('export const cards = 2\n')
  if (vscode.workspace.isTrusted) {
    await until('the renderer built by its watch task', async () => {
      const build = cardsBuild()
      return build?.running && build.state.phase === 'built' ? build : undefined
    })
    assert.ok(vscode.tasks.taskExecutions.some(execution => execution.task.definition.type === 'projections-renderer'))
    await vscode.commands.executeCommand('projections.openProjection', folder, 'cards', {preview: false})
    await until('the Renderer row says built', async () => /· built$/.test((await rendererRow())?.description ?? '') || undefined)
    // A failed build: the Renderer row says so with its error, and Problems has it.
    await saveSource('FAIL\n')
    await until('the build failed', async () => (cardsBuild()?.state.phase === 'failed' ? true : undefined))
    assert.equal(cardsBuild().state.error, 'main.tsx:1:1: The source says FAIL')
    await vscode.commands.executeCommand('projections.openProjection', folder, 'cards', {preview: false})
    const failedRow = await until('the Renderer row says it failed', async () => {
      const row = await rendererRow()
      return /build failed$/.test(row?.description ?? '') ? row : undefined
    })
    assert.match(failedRow.tooltip, /main\.tsx:1:1: The source says FAIL/)
    // On the file the build names (its real path: macOS's temporary directory is under /private).
    const problem = await until('the error in Problems', async () =>
      vscode.languages.getDiagnostics().find(([, items]) => items.some(item => /The source says FAIL/.test(item.message))),
    )
    // The URI's path, '/'-separated on every platform.
    assert.match(problem[0].path, /cards\/src\/main\.tsx$/)
    await saveSource('export const cards = 3\n')
    await until('built again', async () => (cardsBuild()?.state.phase === 'built' ? true : undefined))
  } else {
    // Nothing runs in an untrusted workspace: the row says it needs trust.
    await until('the build waiting for trust', async () => (cardsBuild()?.state.phase === 'untrusted' ? true : undefined))
    assert.equal(cardsBuild().running, false)
  }
  // Once no tab of the projection is open, its watcher stops.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await until('the watcher stopped', async () => (cardsBuild() ? undefined : true))
  await until(
    'its task ended',
    async () => vscode.tasks.taskExecutions.every(execution => execution.task.definition.type !== 'projections-renderer') || undefined,
  )
}
