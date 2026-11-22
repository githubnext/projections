// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')
const {control, until, elements} = require('../helpers.cjs')

module.exports = async function explore({folder}) {
  // Explore: the candidates, though the repository has a projection of its own.
  await vscode.commands.executeCommand('projections.exploreRepository')
  const candidates = await until('the candidates', async () => {
    const found = await elements('[data-candidate]', 'data-candidate')
    return found.length ? found.map(item => item.value) : undefined
  })
  assert.ok(candidates.includes('repository-map'), candidates.join(','))
  // A sweep of the recent changes, and a candidate's cell opened in the Inspector on that change.
  await control({op: 'click', selector: 'section[aria-labelledby="pi-sweep-title"] form button[type="submit"]'})
  const cell = 'td.pi-sweep-cell[data-projection="repository-map"] a'
  const [link] = await until(
    'the swept candidate',
    async () => {
      const found = await elements(cell, 'href')
      return found.length ? found : undefined
    },
    120_000,
  )
  const opened = new URLSearchParams(link.value)
  await control({op: 'click', selector: cell})
  const candidate = await until('the candidate in the Inspector', async () => {
    const summary = await control({op: 'summary'})
    return summary.projection?.id === 'repository-map' && summary.pair.after === opened.get('after') ? summary : undefined
  })
  assert.deepEqual(candidate.projections.map(item => item.id).toSorted(), ['packages', 'repository-map'])
  assert.equal(candidate.pair.before, opened.get('before'))

  // Adopt with a dry run: the preview of the definition it would write, writing nothing.
  const preview = await vscode.commands.executeCommand('projections.adopt', {projections: ['repository-map'], write: false})
  assert.equal(preview.written, false)
  assert.ok(
    preview.files.some(file => file.path === '.github/projections/repository-map.json' && file.created),
    JSON.stringify(preview.files),
  )
  await assert.rejects(fs.stat(path.join(folder.fsPath, '.github/projections/repository-map.json')))
  const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).map(tab => tab.label)
  assert.ok(
    tabs.some(label => /Adopt repository-map \(preview\)/.test(label)),
    tabs.join(', '),
  )
}
