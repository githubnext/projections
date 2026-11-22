// Screenshots of the status bar item in real VS Code (Dark Modern, 1440×900), for docs/design/images/desktop-surfaces/:
// the item on several choices stacked into one picture (status-bar-choices-dark: Current state, Branch changes, a pull
// request, a recent change, a bookmark whose name is cut, two revisions, out of date, and extracting), its tooltip
// (status-bar-tooltip-dark), the tab's summary bar while it extracts (summary-bar-running-dark) and the Viewing quick
// pick its click opens (status-bar-quick-pick-dark). Choices are set with keybindings, which pass projections.setChoice
// its choice; every extraction job is held a few seconds (PROJECTIONS_TEST_HOLD_JOB_MS), long enough to picture one.
//   node scripts/screenshots/status-bar-screenshots.mjs [output directory]
import {execFileSync} from 'node:child_process'
import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright-core'
import {createDemoRepository} from '../../test/smoke/demo-repo.mjs'
import {cli, command, inspectorFrame, launch} from './electron.mjs'

const output = process.argv[2] || fileURLToPath(new URL('../../../../../docs/design/images/desktop-surfaces/', import.meta.url))
process.env.PROJECTIONS_TEST_HOLD_JOB_MS = '6000'
// feature/auth, a commit ahead of main (tagged v1.0), with an untracked package.
const repository = await createDemoRepository(cli, {acme: true})
const git = (...args) => execFileSync('git', args, {cwd: repository}).toString().trim()
const [main, head] = [git('rev-parse', 'main'), git('rev-parse', 'HEAD')]
// A bookmark with a long name, to show how the item cuts it.
await writeFile(
  join(repository, '.projections-bookmarks.json'),
  `${JSON.stringify(
    {
      format: 'projections.bookmarks',
      version: 0,
      bookmarks: [
        {id: 'billing-split', title: 'Auth package, before the billing split', projectionId: 'packages', before: main, after: head},
      ],
    },
    null,
    2,
  )}\n`,
)
const choices = [
  {caption: 'Current state', key: 'ctrl+alt+shift+1', args: {id: 'now'}, name: 'Current state'},
  {caption: 'Branch changes', key: 'ctrl+alt+shift+2', args: {id: 'branch'}, name: 'Branch changes'},
  {
    caption: 'A pull request',
    key: 'ctrl+alt+shift+3',
    args: {id: 'pr:42', pair: {before: main, after: head}, title: '#42 Add the auth package'},
    name: 'PR #42',
  },
  {
    caption: 'A recent change',
    key: 'ctrl+alt+shift+4',
    args: {id: `pair:${main}..${head}`, pair: {before: main, after: head}, title: 'Add auth package'},
    name: 'Add auth package',
  },
  {
    caption: 'A bookmark',
    key: 'ctrl+alt+shift+5',
    args: {id: 'bookmark:billing-split'},
    name: 'Bookmark: Auth package, before the billing split',
  },
  {
    caption: 'Two revisions',
    key: 'ctrl+alt+shift+6',
    args: {id: 'custom', pair: {before: 'v1.0', after: 'HEAD'}},
    name: 'v1.0 → feature/auth',
  },
]
const keybindings = choices.map(choice => ({key: choice.key, command: 'projections.setChoice', args: choice.args}))
const {app, window} = await launch({repository, keybindings})
/** Presses a choice's keybinding, as Playwright names the keys. */
const press = choice => window.keyboard.press(`Control+Alt+Shift+Digit${choice.key.at(-1)}`)
try {
  await command(window, 'View: Show Projections')
  const sidebar = window.locator('.part.sidebar')
  const row = sidebar.locator('.monaco-list-row', {hasText: 'Packages'}).first()
  await row.waitFor({timeout: 60_000})
  await row.click()
  const frame = await inspectorFrame(window)
  await frame.locator('[data-host-ui="vscode"] .phv-root[data-renderer-status="ready"]').first().waitFor({timeout: 90_000})
  await new Promise(resolve => setTimeout(resolve, 3000))
  const statusbar = window.locator('.part.statusbar')
  /** The item, once its accessible label says it shows `name` (and `state`: out of date, or extracting). */
  const item = async (name, state = '') => {
    const found = statusbar.locator(`[aria-label="Projections: viewing ${name}${state ? `, ${state}` : ''}"]`).first()
    await found.waitFor({timeout: 60_000})
    return found
  }
  /** The status bar's left part, where the item sits. */
  const strip = async () => {
    await window.mouse.move(900, 400)
    await new Promise(resolve => setTimeout(resolve, 600))
    const box = await statusbar.boundingBox()
    return window.screenshot({clip: {x: box.x, y: box.y, width: 520, height: box.height}})
  }
  const strips = []
  for (const choice of choices) {
    await press(choice)
    await item(choice.name)
    // A job the choice started shows its spinner in a moment: its strip waits until it ends.
    await new Promise(resolve => setTimeout(resolve, 1500))
    await item(choice.name)
    strips.push({caption: choice.caption, image: await strip()})
  }
  // Out of date: Branch changes after an edit (the tab doesn't refresh on its own).
  await press(choices[1])
  await item('Branch changes')
  await frame.locator('[data-host-ui="vscode"] .phv-root[data-renderer-status="ready"]').first().waitFor({timeout: 90_000})
  await new Promise(resolve => setTimeout(resolve, 3000))
  const web = join(repository, 'packages', 'web', 'package.json')
  const original = await readFile(web, 'utf8')
  const edited = JSON.parse(original)
  edited.dependencies['@demo/auth'] = '1.0.0'
  await writeFile(web, `${JSON.stringify(edited, null, 2)}\n`)
  const stale = await item('Branch changes', 'out of date')
  strips.push({caption: 'Out of date', image: await strip()})
  // The tooltip, out of date.
  await stale.hover()
  const hover = window.locator('.monaco-hover, .workbench-hover').filter({hasText: 'Branch changes'}).first()
  await hover.waitFor({timeout: 10_000})
  await new Promise(resolve => setTimeout(resolve, 800))
  {
    const [tip, bar] = [await hover.boundingBox(), await statusbar.boundingBox()]
    const top = Math.max(0, tip.y - 12)
    await window.screenshot({
      path: join(output, 'status-bar-tooltip-dark.png'),
      clip: {x: 0, y: top, width: Math.min(1440, Math.max(tip.x + tip.width + 16, 520)), height: bar.y + bar.height - top},
    })
    console.log('status-bar-tooltip-dark')
  }
  // Refresh (the item's quick pick starts with it) extracts again: while the job runs the spinner takes the warning's
  // place, and the tab's summary bar spins at its end.
  await window.mouse.move(900, 400)
  await (await item('Branch changes', 'out of date')).click()
  await window.locator('.quick-input-widget .monaco-list-row', {hasText: 'Refresh'}).first().click()
  await item('Branch changes', 'extracting')
  // The item's hover (from its click) goes, so it covers neither picture.
  await window.mouse.move(900, 400)
  await window
    .locator('.monaco-hover, .workbench-hover')
    .first()
    .waitFor({state: 'hidden', timeout: 5000})
    .catch(() => window.keyboard.press('Escape'))
  strips.push({caption: 'Extracting', image: await strip()})
  {
    const summary = frame.locator('[data-summary-bar]').first()
    await summary.locator('[data-summary-running="extracting"] .codicon-sync').waitFor({timeout: 10_000})
    const box = await summary.boundingBox()
    await window.screenshot({
      path: join(output, 'summary-bar-running-dark.png'),
      clip: {x: box.x, y: box.y, width: box.width, height: box.height},
    })
    console.log('summary-bar-running-dark')
  }
  await item('Branch changes')
  await writeFile(web, original)
  // The click: the Viewing quick pick, the side bar's rows grouped, then Show in Side Bar.
  await window.mouse.move(900, 400)
  await (await item('Branch changes', 'out of date')).click()
  const pick = window.locator('.quick-input-widget')
  await pick.locator('.monaco-list-row', {hasText: 'Show in Side Bar'}).waitFor({timeout: 10_000})
  await new Promise(resolve => setTimeout(resolve, 800))
  {
    const box = await pick.boundingBox()
    await window.screenshot({
      path: join(output, 'status-bar-quick-pick-dark.png'),
      clip: {x: box.x - 16, y: Math.max(0, box.y - 16), width: box.width + 32, height: box.height + 32},
    })
    console.log('status-bar-quick-pick-dark')
  }
  await window.keyboard.press('Escape')
  // The strips, captioned and stacked.
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({deviceScaleFactor: 1})
    await page.setContent(
      `<body style="margin:0;display:inline-grid;grid-template-columns:auto auto;gap:6px 12px;padding:10px;background:#111;color:#ccc;font:13px system-ui;align-items:center">${strips
        .map(
          ({caption, image}) =>
            `<span>${caption}</span><img style="display:block;width:520px" src="data:image/png;base64,${image.toString('base64')}">`,
        )
        .join('')}</body>`,
    )
    await page.locator('body').screenshot({path: join(output, 'status-bar-choices-dark.png')})
    console.log('status-bar-choices-dark')
  } finally {
    await browser.close()
  }
} catch (error) {
  // What the window showed when it failed, for debugging (not committed).
  await window.screenshot({path: 'failed-status-bar.png'}).catch(() => {})
  throw error
} finally {
  await app.close()
}
