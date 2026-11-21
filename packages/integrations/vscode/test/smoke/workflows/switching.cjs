// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const {until} = require('../helpers.cjs')

module.exports = async function switching({api, mergeBase, shownSummary}) {
  // One switch is one update. Switching back to a choice the tab has shown redraws the Viewing view once, tells the
  // page its pair once, extracts nothing and reloads nothing, and the page presents the new pair in one change: never
  // an empty, skeleton or loading frame, never a renderer frame reloaded. Rapid switches settle on the last.
  const shows = {
    now: summary => !summary?.pair?.before && summary?.pair?.after === 'working-tree',
    uncommitted: summary => summary?.pair?.before === 'HEAD' && summary.pair.after === 'working-tree',
    branch: summary => summary?.pair?.before === mergeBase,
  }
  const settled = id =>
    until(`the tab settled on ${id}`, async () => {
      const summary = shownSummary()
      return shows[id](summary) && summary.status === 'ok' && (id === 'now' || summary.comparison?.compared) ? summary : undefined
    })
  // Each choice shown once (the definition Now applies differs from the others', D4: both stay for showing again).
  for (const id of ['now', 'uncommitted', 'branch']) {
    await api.viewingActivate(id)
    await settled(id)
  }
  await new Promise(resolve => {
    setTimeout(resolve, 1500)
  })
  const measure = async run => {
    const before = api.counters()
    await api.control('packages', {op: 'probe', reset: true})
    await run()
    // The tab reports twice a second; labels and counts arrive after the pick.
    await new Promise(resolve => {
      setTimeout(resolve, 1500)
    })
    const after = api.counters()
    const delta = Object.fromEntries(
      [...new Set([...Object.keys(before), ...Object.keys(after)])].map(name => [name, (after[name] ?? 0) - (before[name] ?? 0)]),
    )
    return {delta, probe: await api.control('packages', {op: 'probe'})}
  }
  const steady = ({delta, probe}, switches, what) => {
    const facts = JSON.stringify({what, delta, frames: probe.frames, renderer: probe.renderer})
    console.log(
      `Switching ${what}: ${JSON.stringify(delta)}; renderer ${JSON.stringify(probe.renderer)}; ${probe.frames.length} page states`,
    )
    assert.equal(delta['tab.job'] ?? 0, 0, facts)
    assert.equal((delta['page.load'] ?? 0) + (delta['page.restore'] ?? 0), 0, facts)
    assert.equal(probe.renderer.ready ?? 0, 0, facts)
    assert.ok((delta['viewing.refresh'] ?? 0) <= switches, facts)
    assert.ok((delta['projections.refresh'] ?? 0) <= switches, facts)
    assert.ok((delta['tab.pair'] ?? 0) <= switches, facts)
    assert.ok(
      probe.frames.every(frame => !frame.skeleton && !frame.empty && frame.loading === 0 && frame.status === 'ready'),
      facts,
    )
    // The view changes what it presents at most once a switch (comparison or one revision).
    const modes = probe.frames.map(frame => frame.mode).filter((mode, index, all) => index === 0 || mode !== all[index - 1])
    assert.ok(modes.length - 1 <= switches, facts)
  }
  for (const id of ['now', 'branch', 'uncommitted', 'now']) {
    const measured = await measure(async () => {
      await api.viewingActivate(id)
      await settled(id)
    })
    steady(measured, 1, `to ${id}`)
    assert.equal(measured.delta['viewing.refresh'], 1, JSON.stringify(measured.delta))
    assert.equal(measured.delta['tab.setPair'], 1, JSON.stringify(measured.delta))
  }
  const rapid = await measure(async () => {
    for (const id of ['uncommitted', 'branch', 'now', 'branch']) await api.viewingActivate(id)
    await settled('branch')
  })
  steady(rapid, 4, 'rapidly')
  assert.ok(shows.branch(shownSummary()), JSON.stringify(shownSummary()))
}
