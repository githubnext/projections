// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {until} = require('../helpers.cjs')

module.exports = async function framing({folder, api, shownSummary, tabShows}) {
  // Projection tabs follow the folder's pair. Keep a Packages tab (not the preview) and wait for its comparison.
  await vscode.commands.executeCommand('projections.openProjection', folder, 'packages', {preview: false})
  await tabShows('the kept Packages tab', () => true)
  // It opens fitted, the whole projection in view, unless that would draw its text below the renderers' 8 px opening
  // floor (this tab is narrow): then it opens zoomed to that floor, at the top of its content, and scrolls. Either way
  // the opening framing settles, and Fit to view then puts every changed entity inside the frame.
  const inFrame = (anchor, frame) =>
    anchor.x >= frame.x - 1 &&
    anchor.y >= frame.y - 1 &&
    anchor.x + anchor.width <= frame.x + frame.width + 1 &&
    anchor.y + anchor.height <= frame.y + frame.height + 1
  // Changed entities as drawn: an anchor is null while its entity is scrolled out of the frame.
  const changedAnchors = async () => {
    const found = await api.control('packages', {op: 'anchors'})
    return found.frame && found.anchors.length ? found : undefined
  }
  const anchorsOf = found => JSON.stringify(found.anchors.map(item => item.anchor && [item.anchor.x, item.anchor.y, item.anchor.width]))
  let previous
  const opening = await until('the opening framing settled', async () => {
    const found = await changedAnchors()
    const settled = found && previous && anchorsOf(found) === anchorsOf(previous) && found.anchors.some(item => item.anchor)
    previous = found
    return settled ? found : undefined
  })
  const fitted = opening.anchors.every(item => item.anchor && inFrame(item.anchor, opening.frame))
  assert.ok(
    opening.anchors.every(item => !item.anchor || inFrame(item.anchor, opening.frame)),
    JSON.stringify(opening),
  )
  if (!fitted) {
    // Opened at the floor: Fit to view (the `…` command on the active tab) shows everything, drawn smaller than it opened.
    assert.ok((shownSummary()?.view?.zoom ?? []).includes('zoom-fit'), JSON.stringify(shownSummary()))
    await vscode.commands.executeCommand('projections.zoom.fit')
    const all = await until('the view fitted', async () => {
      const found = await changedAnchors()
      return found?.anchors.every(item => item.anchor && inFrame(item.anchor, found.frame)) ? found : undefined
    })
    const width = (found, id) => found.anchors.find(item => item.id === id)?.anchor?.width
    const shown = opening.anchors.find(item => item.anchor)
    assert.ok(width(all, shown.id) < width(opening, shown.id), JSON.stringify({opening, all}))
  }
}
