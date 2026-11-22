// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function staleness({folder, api, mergeBase, projectionTabs}) {
  // D5: nothing refreshes on its own. Editing a file makes the open tab's result out of date, without extracting it
  // again: the notice in a pill over its stage, "Out of date" in its row and a dot on the status bar item (its tooltip
  // says why); Refresh clears them.
  const current = await until('the tab compared on My branch', async () => {
    const [shownTab] = api.tabs('packages')
    return shownTab?.summary?.comparison?.compared && shownTab.summary.pair.before === mergeBase && !shownTab.stale ? shownTab : undefined
  })
  const webPackage = path.join(folder.fsPath, 'packages', 'web', 'package.json')
  const webOriginal = await fs.readFile(webPackage, 'utf8')
  const edited = JSON.parse(webOriginal)
  edited.dependencies['@demo/auth'] = '1.0.0'
  await fs.writeFile(webPackage, `${JSON.stringify(edited, null, 2)}\n`)
  const stale = await until('the tab out of date', async () => api.tabs('packages')[0]?.stale ?? undefined)
  assert.deepEqual([stale.tier, stale.why, stale.files], ['extraction', 'working tree', 1])
  // The notice is the stage's, not a toolbar control: a pill over the stage with its label, count and Refresh.
  const notice = async () =>
    (
      await api.control('packages', {
        op: 'elements',
        selector: '.phv-workspace > .phv-stage-notice-slot > .phv-stage-notice[role="status"][data-notice]',
        attribute: 'data-notice',
      })
    )[0]?.value
  assert.equal(await until('the out-of-date notice', notice), 'Out of date · 1 file changed')
  assert.deepEqual(
    (
      await api.control('packages', {
        op: 'elements',
        selector: '.phv-stage-notice :is(.phv-stage-notice-label, .phv-stage-notice-detail, .phv-stage-notice-action)',
      })
    ).map(element => element.text),
    ['Out of date', '· 1 file changed', 'Refresh'],
  )
  assert.equal(
    (await api.control('packages', {op: 'elements', selector: '.phv-toolbar-wrap [data-notice], .phv-toolbar-wrap .phv-stage-notice'}))
      .length,
    0,
  )
  await until('the row out of date', async () => api.rows()[0].projections[0].description === 'Out of date')
  assert.equal(api.rows()[0].projections[0].status, 'Out of date')
  await until('the status bar out of date', async () =>
    api.status() === '$(projections-mark) Branch changes $(warning)' ? true : undefined,
  )
  assert.match(api.statusBar().tooltip, /Packages is out of date: 1 file changed since its result\. Click to refresh it\./u)
  assert.match(api.statusBar().tooltip, /1 projection is out of date: the files changed since its result\. Refresh its tab/u)
  assert.equal(api.statusBar().accessibility, 'Projections: viewing Branch changes, out of date')
  // Nothing extracted again: the same jobs and the same result, once the tab has checked the change (the page would
  // have asked for a job on the same notification).
  await until('the change checked', async () => api.tabs('packages')[0].checked >= api.generation())
  const after = api.tabs('packages')[0]
  assert.equal(after.jobs, current.jobs)
  assert.deepEqual(after.summary.results, current.summary.results)
  assert.deepEqual(after.summary.comparison, current.summary.comparison)
  // Refresh (the pill's button) extracts it again and clears the notice, the row and the count. While its job runs
  // (held, as a long extraction is), the status bar item spins in the warning's place and the summary bar spins at its
  // end; both clear once the job ends.
  const spinners = async () =>
    (await api.control('packages', {op: 'elements', selector: '.phv-summary-bar [data-summary-running] .codicon-sync', attribute: 'title'}))
      .length
  assert.equal(await spinners(), 0)
  api.holdJobs(4000)
  await api.control('packages', {op: 'click', selector: '.phv-stage-notice-action'})
  await until('the status bar spinner', async () =>
    /^\$\(projections-mark\) Branch changes \$\(sync(?:~spin)?\)$/u.test(api.status()) ? true : undefined,
  )
  assert.equal(api.statusBar().accessibility, 'Projections: viewing Branch changes, extracting')
  assert.match(api.statusBar().tooltip, /\n\nPackages: Extracting…\n/u)
  assert.doesNotMatch(api.statusBar().tooltip, /Click to refresh it/u)
  await until('the summary bar spinner', async () => ((await spinners()) ? true : undefined))
  assert.deepEqual(
    (await api.control('packages', {op: 'elements', selector: '.phv-summary-bar [data-summary-running]', attribute: 'title'})).map(
      element => element.value,
    ),
    ['Extracting…'],
  )
  api.holdJobs(0)
  const refreshed = await until('the refreshed tab', async () => {
    const [shownTab] = api.tabs('packages')
    const results = shownTab?.summary?.results
    return Object.keys(results ?? {}).length === 2 &&
      (results?.['working-tree']?.job ?? current.summary.results['working-tree'].job) !== current.summary.results['working-tree'].job &&
      !shownTab.stale &&
      shownTab.summary.comparison?.compared
      ? shownTab
      : undefined
  })
  assert.ok(refreshed.jobs > current.jobs, `${refreshed.jobs} jobs after ${current.jobs}`)
  assert.equal((await api.control('packages', {op: 'elements', selector: '[data-notice]'})).length, 0)
  await until('the row counted again', async () => /^\d+ changes?$/u.test(api.rows()[0].projections[0].status))
  await until('the status bar current', async () => (api.status() === '$(projections-mark) Branch changes' ? true : undefined))
  await until('the summary bar spinner gone', async () => ((await spinners()) === 0 ? true : undefined))
  // Put the file back: out of date again, and refreshed.
  await fs.writeFile(webPackage, webOriginal)
  await until('the tab out of date again', async () => api.tabs('packages')[0]?.stale ?? undefined)
  const staleJob = api.tabs('packages')[0].summary.results['working-tree'].job
  // The status bar item's quick pick starts with Refresh while the tab in front is out of date; it refreshes the tab.
  await until('the status bar warning again', async () => (api.status()?.endsWith(' $(warning)') ? true : undefined))
  {
    const bar = api.statusBar()
    const choosing = vscode.commands.executeCommand(bar.command, vscode.Uri.parse(bar.arguments[0]))
    const shown = await until('the Viewing quick pick with Refresh', async () => api.pickItems() ?? undefined)
    assert.match(shown.items[0], /^\$\(refresh\) Refresh · 1 file changed$/u)
    assert.equal(shown.items[1], '---')
    await api.pick(shown.items[0])
    await choosing
  }
  await until('the tab current again', async () => {
    const [shownTab] = api.tabs('packages')
    return (
      (shownTab?.summary?.results?.['working-tree']?.job ?? staleJob) !== staleJob &&
      Object.keys(shownTab.summary.results).length === 2 &&
      !shownTab.stale &&
      shownTab.summary.comparison?.compared &&
      api.rows()[0].projections[0].status !== 'Out of date'
    )
  })

  // A hidden tab's webview is dropped (no retainContextWhenHidden): the extension keeps its results, and when it comes
  // back its page presents them again without extracting, out of date after an edit made while it was hidden.
  const shownBefore = api.tabs('packages')[0]
  await vscode.window.showTextDocument(vscode.Uri.joinPath(folder, 'package.json'), {preview: false})
  await until('the projection tab hidden', async () => !projectionTabs().some(tab => tab.isActive))
  await fs.writeFile(webPackage, `${JSON.stringify(edited, null, 2)}\n`)
  await until('the hidden tab out of date', async () => api.tabs('packages')[0]?.stale ?? undefined)
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages')
  const back = await until('the tab back, its page reloaded', async () => {
    const [shownTab] = api.tabs('packages')
    // The reloaded page's own report: its restored results, compared.
    return shownTab?.loads > shownBefore.loads && shownTab.summary?.results?.['working-tree'] && shownTab.summary.comparison?.compared
      ? shownTab
      : undefined
  })
  assert.equal(await until('the notice on the restored tab', notice), 'Out of date · 1 file changed')
  assert.equal(back.jobs, shownBefore.jobs, 'the restored page extracted nothing')
  assert.deepEqual(back.summary.results, shownBefore.summary.results)
  assert.deepEqual(back.summary.comparison, shownBefore.summary.comparison)
  await fs.writeFile(webPackage, webOriginal)
  await vscode.commands.executeCommand('workbench.action.closeOtherEditors')
  const keptJob = shownBefore.summary.results['working-tree'].job
  // Once the change is seen the file is as the result read it. With the backend's identity (the working tree's tree
  // hash) the result is current again; under the changes rule alone it stays out of date with no files changed.
  await until('the restore seen', async () => {
    const stale = api.tabs('packages')[0]?.stale
    return stale === undefined || stale === null || stale === false || stale.files === 0
  })
  await vscode.commands.executeCommand('projections.refreshProjection', {
    model: {folder: vscode.workspace.workspaceFolders[0]},
    definition: {id: 'packages'},
  })
  await until('the restored tab refreshed', async () => {
    const [shownTab] = api.tabs('packages')
    return (
      (shownTab?.summary?.results?.['working-tree']?.job ?? keptJob) !== keptJob &&
      Object.keys(shownTab.summary.results).length === 2 &&
      !shownTab.stale &&
      shownTab.summary.comparison?.compared
    )
  })
}
