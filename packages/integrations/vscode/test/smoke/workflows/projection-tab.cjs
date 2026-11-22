// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function projectionTab({folder, api, manifest, mergeBase, choiceName, swaps, summaryBar}) {
  // A projection opens as its own tab (the projection editor on a projection: resource), titled by the projection and
  // showing it alone, compared on its pair; the side bar row then says how much changed.
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages')
  const tab = await until('the projection tab', async () =>
    vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .find(
        open =>
          open.input instanceof vscode.TabInputCustom && open.input.viewType === 'projections.projection' && open.label === 'Packages',
      ),
  )
  assert.equal(tab.input.uri.scheme, 'projection')
  // The tab painted its skeleton at once: its first document, set before its folder's facts or the backend were
  // ready, already has the toolbar strip (empty: no stand-ins for its controls) and "Loading Packages…", and the backend
  // was bound only after it.
  const firstTab = api.tabs('packages')[0]
  assert.match(firstTab.firstPage?.html ?? '', /<div class="pj-skeleton-toolbar" aria-hidden="true"><\/div>/u)
  assert.doesNotMatch(firstTab.firstPage.html, /pj-skeleton-(modes|end|icon)/u)
  assert.match(firstTab.firstPage.html, /Loading Packages…/u)
  assert.ok(
    firstTab.boundAt === null || firstTab.firstPage.at <= firstTab.boundAt,
    JSON.stringify({at: firstTab.firstPage.at, bound: firstTab.boundAt}),
  )
  // Its tab shows the Projections mark (the panel's icon), not the file icon theme's generic file.
  assert.equal(api.tabs('packages')[0]?.icon, 'projection-dark.svg')
  const shown = await until('the projection in its tab', async () => {
    const summary = await api.control('packages', {op: 'summary'})
    return summary.projection?.id === 'packages' && summary.comparison?.compared ? summary : undefined
  })
  assert.equal(shown.status, 'ok')
  // No Inspector shell: no title bar, Explorer or status bar.
  assert.equal((await api.control('packages', {op: 'elements', selector: '.pi-titlebar, .pi-statusbar'})).length, 0)
  // The summary bar along the bottom of the tab: each kind in the dependency graph's words, with the comparison's changes.
  const changesBar = await until('the summary bar with changes', async () => {
    const sentence = await summaryBar()
    return /^\d+ workspaces? .*· \d+ dependenc(?:y|ies)/u.test(sentence) && /[+\u2212~]\d/u.test(sentence) ? sentence : undefined
  })
  assert.ok(!/\bpackage:|depends-on|devDependencies/u.test(changesBar), changesBar)
  // D2: with nothing picked, a new tab opens on the automatic choice. The demo repository is on feature/auth, a commit
  // ahead of main, with an uncommitted definition, so it's My branch: the merge base with main → the working tree.
  assert.deepEqual([shown.pair.before, shown.pair.after], [mergeBase, 'working-tree'])
  const automatic = api.rows()[0].choice
  assert.deepEqual([automatic.id, automatic.automatic, automatic.remembered], ['branch', true, null])
  // D6: no Compare section or its setting; the side bar's header line names the choice.
  const views = manifest.views.projections.map(view => view.id)
  assert.ok(!views.some(id => /compare/iu.test(id)), views.join(','))
  assert.equal(manifest.configuration.properties['projections.compareStyle'], undefined)
  // Each choice says its span with real ref names, then its size.
  assert.match(api.rows()[0].header, /^Branch changes · main → your files · 1 commit \+ \d+ uncommitted$/u)
  // The Viewing view is the one list of what every tab shows: native rows, the current one checked (and ", selected"
  // to a screen reader). Its title stays "Viewing": the status bar item is the readout of the choice, the projector
  // mark and the choice's short name, nothing the tab shows. Rows say short facts; their tooltips explain.
  assert.equal(await until('the status bar on Branch changes', choiceName), 'Branch changes')
  assert.ok([null, 'Viewing'].includes(api.viewing().title), api.viewing().title)
  assert.equal(manifest.views.projections.find(view => view.id === 'projections.viewing').name, 'Viewing')
  assert.equal(api.viewing().description, null)
  {
    const bar = api.statusBar()
    assert.equal(bar.text, '$(projections-mark) Branch changes')
    assert.deepEqual([bar.command, bar.arguments], ['projections.changePair', [folder.toString()]])
    // The details are the tooltip's: the revisions with their commits, the span and the files changed.
    assert.match(bar.tooltip, /^\*\*Branch changes\*\*/u)
    assert.match(bar.tooltip, new RegExp(`\\\`${mergeBase.slice(0, 7)}\\\` → your files`))
    await until('the files changed in the tooltip', async () =>
      /1 commit \+ \d+ uncommitted · \d+ files? changed/u.test(api.statusBar().tooltip) ? true : undefined,
    )
    assert.equal(bar.accessibility, 'Projections: viewing Branch changes')
    // The projector mark is a product icon of the extension's font.
    assert.equal(manifest.icons['projections-mark'].default.fontCharacter, '\\E000')
  }
  {
    const viewing = api.viewing()
    const checked = viewing.rows.filter(row => row.checked)
    assert.deepEqual(
      checked.map(row => row.id),
      ['branch'],
    )
    assert.match(checked[0].accessibility, /, selected$/u)
    assert.ok(viewing.rows.filter(row => !row.checked).every(row => !/, selected$/u.test(row.accessibility ?? '')))
    assert.deepEqual(
      viewing.rows
        .filter(
          row =>
            (row.kind === 'choice' && ['now', 'uncommitted', 'branch'].includes(row.id)) || ['pr', 'group', 'compare'].includes(row.kind),
        )
        .map(row => row.label),
      ['Current state', 'Uncommitted changes', 'Branch changes', 'Pull request…', 'Recent changes', 'Compare two revisions…'],
    )
    const fact = id => viewing.rows.find(row => row.id === id)?.description
    assert.deepEqual([fact('now'), fact('branch'), fact('compare')], ['', '1 commit', ''])
    assert.match(fact('uncommitted'), /^\d+ files?$/u)
    assert.ok(
      viewing.rows.every(row => (row.description ?? '').length <= 20),
      JSON.stringify(viewing.rows.map(row => row.description)),
    )
    assert.match(viewing.rows.find(row => row.id === 'branch').tooltip, /What your branch changes/u)
    // "Bookmark this" is on the current row.
    assert.match(checked[0].contextValue, /\bbookmarkable\b/u)
    assert.equal(await swaps(), 0)
    assert.ok(!/\b[Pp]airs?\b/u.test(JSON.stringify(viewing.rows)), JSON.stringify(viewing.rows))
  }
  // Tabs have no choice control of their own: they follow the side bar's.
  await until(
    'the tab toolbar',
    async () => (await api.control('packages', {op: 'elements', selector: '.tp-pair'})).length > 0 || undefined,
  )
  assert.equal((await api.control('packages', {op: 'elements', selector: '.tp-choice, .tp-choice-button, .tp-pinned'})).length, 0)
  // An ordinary local result has no provenance badge.
  assert.equal((await api.control('packages', {op: 'elements', selector: '[data-provenance="Local"]'})).length, 0)
  // From its first paint, the tab never showed the web Inspector's empty state, and showed at most one small
  // loading indicator at a time (VS Code's 2px progress bar), never a ring that scales with a pane.
  {
    const probe = await api.control('packages', {op: 'probe'})
    console.log(
      `Projection tab: first contentful paint at ${Math.round(probe.firstPaint ?? -1)} ms; skeleton ${probe.skeleton ? 'shown' : 'not seen'}; page loaded ${probe.visibility}`,
    )
    assert.equal(probe.visibility, 'visible', 'the window was hidden when the tab loaded, so nothing it draws can be measured')
    assert.ok(probe.firstPaint !== undefined && probe.skeleton, JSON.stringify(probe))
    assert.equal(probe.empty, false, JSON.stringify(probe))
    assert.ok(probe.most <= 1 && probe.tallest <= 24, JSON.stringify(probe))
    // The skeleton's toolbar strip never held a control, and is exactly as tall as the toolbar that replaced it.
    const [toolbar] = await api.control('packages', {op: 'boxes', selector: '.phv-toolbar'})
    assert.equal(probe.strip.elements, 0, JSON.stringify(probe.strip))
    assert.ok(Math.abs(probe.strip.height - (toolbar.bottom - toolbar.top)) <= 0.5, JSON.stringify({strip: probe.strip, toolbar}))
  }
  assert.equal((await api.control('packages', {op: 'elements', selector: '.tp-picker'})).length, 0, 'no Before and After pickers')
  // Side by side labels its panes (chips on the stage) as the pickers name the revisions, never a bare commit.
  await api.control('packages', {op: 'view', action: 'setMode', value: 'side-by-side'})
  const named = text => text.replace(/^(Before|After) revision: /u, '')
  await until('the side by side pane labels, named for people', async () => {
    const found = await api.control('packages', {op: 'elements', selector: '[data-pane-chip]'})
    return found.length === 2 && found.every(band => band.text && !/^[0-9a-f]{8}$/u.test(named(band.text))) ? found : undefined
  })
  // The panes fill the stage edge to edge: no margin, no gap, no rounded card; one 1px divider between them.
  {
    const [stage] = await api.control('packages', {op: 'boxes', selector: '.ph-panes'})
    const [before, after] = await api.control('packages', {op: 'boxes', selector: '.ph-panes > .ph-pane'})
    const near = (a, b) => Math.abs(a - b) <= 0.5
    const flush = JSON.stringify({stage, before, after})
    assert.ok(near(before.left, stage.left) && near(after.right, stage.right) && near(before.top, stage.top), flush)
    if (near(before.top, after.top)) {
      // Columns: the after pane starts where the before pane ends, its 1px left border the divider.
      assert.ok(near(after.left, before.right) && after.borderLeft === '1px', flush)
    } else assert.ok(near(after.top, before.bottom) && after.borderTop === '1px', flush)
    assert.ok(
      [before, after].every(pane => pane.radius === '0px'),
      flush,
    )
    const [box] = await api.control('packages', {op: 'boxes', selector: '.phv-box-body'})
    assert.ok(near(box.left, stage.left) && near(box.right, stage.right), JSON.stringify({box, stage}))
  }
  await until('the change count in the side bar', async () =>
    /^(?:\d+ changes?|no change)$/u.test(api.rows()[0].projections[0].status) ? true : undefined,
  )
  // Play runs the whole transition in the webview. Starting playback changes what the tab reports, so the extension
  // names the pair again; that relabelling must not recompute the comparison, which replaced the subject and reset the
  // slider to the end after a few percent.
  {
    await api.control('packages', {op: 'view', action: 'setMode', value: 'animated'})
    const play = async () => (await api.control('packages', {op: 'elements', selector: '.phv-play', attribute: 'data-icon'}))[0]?.value
    const position = async () =>
      Number((await api.control('packages', {op: 'elements', selector: '.phv-root', attribute: 'data-position'}))[0]?.value)
    // The mode change settles before the button offers to play from the start (on a slow runner it can show the
    // end's play-backward first).
    await until(
      'the play button',
      async () => ((await play()) === 'play' ? true : undefined),
      10_000,
      async () => ({
        icon: await play(),
        position: await position(),
        motion: (await api.control('packages', {op: 'elements', selector: '[data-motion]', attribute: 'data-motion'}))[0]?.value,
      }),
    )
    await api.control('packages', {op: 'view', action: 'togglePlayback'})
    await until('playback', async () => (await play()) === 'pause', 10_000)
    // One forward turn, until looping (the default) turns back at the end.
    const samples = []
    for (const start = Date.now(); Date.now() - start < 30_000;) {
      const [at, label] = await Promise.all([position(), play()])
      if (samples.length && samples.at(-1).at > 0.5 && at < samples.at(-1).at) break
      samples.push({at, playing: label === 'pause'})
      if (!samples.at(-1).playing) break
      await new Promise(resolve => {
        setTimeout(resolve, 40)
      })
    }
    const trace = JSON.stringify(samples.map(({at, playing}) => `${Math.round(at * 1000) / 1000}${playing ? '' : ' stopped'}`))
    assert.ok(
      samples.every(sample => sample.playing),
      `Playback stopped: ${trace}`,
    )
    assert.ok(
      samples.every((sample, index) => index === 0 || sample.at >= samples[index - 1].at - 1e-9),
      `Playback went backward: ${trace}`,
    )
    assert.ok(samples.filter(({at}) => at > 0.1 && at < 0.9).length >= 5, `Playback skipped the transition: ${trace}`)
    assert.ok(samples.at(-1).at >= 0.95, `Playback didn't reach the end: ${trace}`)
    await api.control('packages', {op: 'view', action: 'togglePlayback'})
    await until('playback paused', async () => (await play()) !== 'pause', 10_000)
  }

  // A changed projection's row shows its count as a badge in the modified color (a FileDecoration on its row's
  // resource, beside its icon); no change, no badge. Its description says nothing about it.
  {
    const [row] = api.rows()[0].projections
    const decoration = api.decoration('packages')
    const count = /^(\d+) changes?$/u.exec(row.status)?.[1]
    assert.match(row.resource ?? '', /^projections-row:/u)
    if (count) {
      assert.deepEqual([decoration.badge, decoration.color], [Number(count) > 9 ? '9+' : count, 'gitDecoration.modifiedResourceForeground'])
      console.log(`Projections row badge: ${decoration.badge} (${decoration.tooltip})`)
    } else assert.equal(decoration.badge, null)
    assert.ok(!/change/u.test(row.description), row.description)
  }
}
