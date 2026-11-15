// Screenshots of New Projection… in real VS Code (Dark and Light Modern, 1440×900, the side bar at 300 px), for
// docs/design/images/desktop-surfaces/: the (+) in the Projections section's title bar with the first pick
// (new-projection-pick-*), the renderers that fit the chosen built-in extractor, its default first
// (new-projection-renderer-*), and the window once projections init has written it with the default: its definition
// and tab open, its row selected
// (new-projection-created-*). Each theme runs on a fresh demo repository.
//   node scripts/screenshots/new-projection-screenshots.mjs [output directory]
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createDemoRepository} from '../../test/smoke/demo-repo.mjs'
import {cli, command, inspectorFrame, launch} from './electron.mjs'

const output = process.argv[2] || fileURLToPath(new URL('../../../../../docs/design/images/desktop-surfaces/', import.meta.url))
const themes = [
  {suffix: 'dark', theme: 'Default Dark Modern', kind: 'dark'},
  {suffix: 'light', theme: 'Default Light Modern', kind: 'light'},
]
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Drags the side bar's edge so it is `width` px wide. */
async function sideBarWidth(window, width) {
  const box = await window.locator('.part.sidebar').boundingBox()
  if (!box || Math.abs(box.width - width) < 2) return
  const y = box.y + box.height / 2
  await window.mouse.move(box.x + box.width - 1, y)
  await window.mouse.down()
  await window.mouse.move(box.x + width - 1, y, {steps: 8})
  await window.mouse.up()
  await pause(300)
}

for (const {suffix, theme, kind} of themes) {
  const repository = await createDemoRepository(cli, {acme: true})
  const {app, window} = await launch({
    repository,
    theme,
    kind,
    // The view's title actions show without hovering it.
    userSettings: {'workbench.view.alwaysShowHeaderActions': true},
  })
  try {
    await command(window, 'View: Show Projections')
    await sideBarWidth(window, 300)
    const sidebar = window.locator('.part.sidebar')
    await sidebar.locator('.monaco-list-row', {hasText: 'Packages'}).first().waitFor({timeout: 60_000})
    await pause(1500)
    const pick = window.locator('.quick-input-widget')
    const projections = sidebar.locator('.pane-header', {hasText: /^\s*Projections/})
    /** The window's top part: the side bar down to the Projections section's rows, and the quick pick over the editor. */
    const top = async file => {
      await pause(800)
      const [header, widget] = [await projections.boundingBox(), await pick.boundingBox()]
      await window.screenshot({
        path: join(output, `${file}-${suffix}.png`),
        clip: {
          x: 0,
          y: 0,
          width: Math.min(1440, widget.x + widget.width + 24),
          height: Math.max(header.y + header.height + 72, widget.y + widget.height + 24),
        },
      })
      console.log(`${file}-${suffix}`)
    }
    // The (+) in the Projections section's title bar.
    await projections.locator('.action-label[aria-label="New Projection…"]').click()
    await pick.locator('.monaco-list-row', {hasText: 'Ask an agent to write it'}).waitFor({timeout: 20_000})
    await top('new-projection-pick')
    await pick.locator('.monaco-list-row', {hasText: 'Start from a built-in extractor and renderer'}).click()
    await pick.locator('.monaco-list-row', {hasText: 'Workspace dependencies'}).first().waitFor({timeout: 30_000})
    await pick.locator('input').fill('Workspace dependencies')
    await pause(300)
    await window.keyboard.press('Enter')
    await pick.locator('.monaco-list-row', {hasText: 'File packing'}).waitFor({timeout: 20_000})
    await top('new-projection-renderer')
    // The extractor's default renderer, which draws the packages.
    await pick.locator('.monaco-list-row', {hasText: 'Graph'}).first().click()
    // The ID, then the title.
    await pick.locator('.quick-input-title', {hasText: 'New projection: ID'}).waitFor({timeout: 20_000})
    await pick.locator('input').fill('package-map')
    await pause(300)
    await window.keyboard.press('Enter')
    await pick.locator('.quick-input-title', {hasText: 'New projection: title'}).waitFor({timeout: 20_000})
    await pick.locator('input').fill('Package map')
    await pause(300)
    await window.keyboard.press('Enter')
    // Written: its row selected, its definition and tab open, the graph drawn.
    await sidebar.locator('.monaco-list-row.selected', {hasText: 'Package map'}).waitFor({timeout: 60_000})
    const frame = await inspectorFrame(window)
    await frame.locator('.phv-root[data-renderer-status="ready"]').first().waitFor({timeout: 90_000})
    await window.mouse.move(900, 600)
    await pause(2500)
    await window.screenshot({path: join(output, `new-projection-created-${suffix}.png`)})
    console.log(`new-projection-created-${suffix}`)
  } catch (error) {
    // What the window showed when it failed, for debugging (not committed).
    await window.screenshot({path: `failed-new-projection-${suffix}.png`}).catch(() => {})
    throw error
  } finally {
    await app.close()
  }
}
