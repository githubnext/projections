// Screenshots of the side bar in real VS Code (Dark and Light Modern, 1440×900, the side bar at 300 px), for
// docs/design/images/desktop-surfaces/: the four sections (Viewing with Recent changes open, Projections with its change
// badge, Definition following the tab, Suggested) beside a projection tab, as sidebar-four-sections-*; in Dark Modern,
// the sections collapsed, their titles static (sidebar-collapsed-dark), the Testing view after a run
// (testing-view-dark), a comparator test file's gutter (comparator-test-gutter-dark), side by side
// (vscode-side-by-side-after), a tab while it loads (vscode-loading-after), a tab before its backend is ready, its
// skeleton (tab-skeleton-*), the out-of-date notice over the stage after a file is edited (jobs-out-of-date-dark, and
// stale-notice-after-* in Dark and Light Modern), the tab applying the definition's edits after Refresh, "Your edits ·
// Show committed" (jobs-edited-*), the side bar with Definition open on its part icons (definition-part-icons-*), a
// built-in row's documentation in the Markdown preview (definition-docs-preview-*) and its Open Documentation on GitHub
// on hover (definition-open-on-github-dark).
//   node scripts/screenshots/jobs-screenshots.mjs [output directory] [sidebar-four-sections-dark,…,jobs-edited-dark]
import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createDemoRepository} from '../../test/smoke/demo-repo.mjs'
import {chromium} from 'playwright-core'
import {cli, command, inspectorFrame, launch} from './electron.mjs'

const noop = () => undefined

const output = process.argv[2] || fileURLToPath(new URL('../../../../../docs/design/images/desktop-surfaces/', import.meta.url))
const only = process.argv[3]?.split(',')
// feature/auth, a commit ahead of main, with an untracked package: the tab opens on My branch.
const repository = await createDemoRepository(cli, {acme: true})
const shots = [
  {
    file: 'sidebar-four-sections-dark',
    collapsed: 'sidebar-collapsed-dark',
    testing: 'testing-view-dark',
    gutter: 'comparator-test-gutter-dark',
    theme: 'Default Dark Modern',
    kind: 'dark',
  },
  {file: 'sidebar-four-sections-light', theme: 'Default Light Modern', kind: 'light'},
  {file: 'tab-skeleton-dark', theme: 'Default Dark Modern', kind: 'dark', skeleton: true},
  {file: 'tab-skeleton-light', theme: 'Default Light Modern', kind: 'light', skeleton: true},
  {file: 'summary-bar-vscode-dark', theme: 'Default Dark Modern', kind: 'dark', summaryBar: true},
  {file: 'summary-bar-vscode-light', theme: 'Default Light Modern', kind: 'light', summaryBar: true},
  {file: 'vscode-loading-after', theme: 'Default Dark Modern', kind: 'dark', loading: true},
  {file: 'vscode-side-by-side-after', theme: 'Default Dark Modern', kind: 'dark', sideBySide: true},
  {file: 'jobs-out-of-date-dark', theme: 'Default Dark Modern', kind: 'dark', edit: true},
  {file: 'stale-notice-after-dark', theme: 'Default Dark Modern', kind: 'dark', edit: true},
  {file: 'stale-notice-after-light', theme: 'Default Light Modern', kind: 'light', edit: true},
  {file: 'jobs-edited-dark', theme: 'Default Dark Modern', kind: 'dark', definition: true},
  {file: 'jobs-edited-light', theme: 'Default Light Modern', kind: 'light', definition: true},
  {file: 'definition-part-icons-dark', theme: 'Default Dark Modern', kind: 'dark', parts: true},
  {file: 'definition-part-icons-light', theme: 'Default Light Modern', kind: 'light', parts: true},
  {file: 'definition-docs-preview-dark', github: 'definition-open-on-github-dark', theme: 'Default Dark Modern', kind: 'dark', docs: true},
  {file: 'definition-docs-preview-light', theme: 'Default Light Modern', kind: 'light', docs: true},
]
const wanted = name => !only || only.includes(name)
const names = item => [item.file, ...['collapsed', 'testing', 'gutter', 'github'].flatMap(key => (item[key] ? [item[key]] : []))]
/** Drags the side bar's edge so it is `width` px wide. */
async function sideBarWidth(window, width) {
  const box = await window.locator('.part.sidebar').boundingBox()
  if (!box || Math.abs(box.width - width) < 2) return
  const y = box.y + box.height / 2
  await window.mouse.move(box.x + box.width - 1, y)
  await window.mouse.down()
  await window.mouse.move(box.x + width - 1, y, {steps: 8})
  await window.mouse.up()
  await new Promise(resolve => {
    setTimeout(resolve, 300)
  })
}
/** A section's header in the Projections container, by its title's start. */
const header = (sidebar, title) => sidebar.locator('.pane-header', {hasText: new RegExp(`^\\s*${title}`)}).first()
/** Expands (or collapses) a section. */
async function section(sidebar, title, expanded) {
  const found = header(sidebar, title)
  await found.waitFor({timeout: 30_000})
  if (((await found.getAttribute('aria-expanded')) === 'true') !== expanded) await found.click()
  await new Promise(resolve => {
    setTimeout(resolve, 300)
  })
}
for (const shot of shots.filter(item => names(item).some(wanted))) {
  // The tab's skeleton: its backend held (a test-only hook in the extension), so the tab shows it until captured.
  if (shot.skeleton) process.env.PROJECTIONS_TEST_HOLD_BACKEND_MS = '30000'
  else delete process.env.PROJECTIONS_TEST_HOLD_BACKEND_MS
  const {app, window} = await launch({repository, theme: shot.theme, kind: shot.kind})
  try {
    await command(window, 'View: Show Projections')
    await sideBarWidth(window, 300)
    const sidebar = window.locator('.part.sidebar')
    const row = sidebar.locator('.monaco-list-row', {hasText: 'Packages'}).first()
    await row.waitFor({timeout: 60_000})
    await row.click()
    if (shot.skeleton) {
      const frame = await inspectorFrame(window)
      await frame.locator('[data-skeleton] .pj-skeleton-toolbar').waitFor({timeout: 30_000})
      await new Promise(resolve => {
        setTimeout(resolve, 1500)
      })
      if (!(await frame.locator('[data-skeleton]').count())) throw new Error('The skeleton went before the backend was held')
      await window.screenshot({path: join(output, `${shot.file}.png`)})
      console.log(shot.file)
      continue
    }
    if (shot.loading) {
      // VS Code's thin progress bar at the tab's top, once the load runs past 300 ms.
      const frame = await inspectorFrame(window)
      await frame.locator('[data-loading-indicator]').first().waitFor({timeout: 30_000})
      await new Promise(resolve => {
        setTimeout(resolve, 150)
      })
      await window.screenshot({path: join(output, `${shot.file}.png`)})
      console.log(shot.file)
      continue
    }
    const frame = await inspectorFrame(window)
    await frame.locator('[data-host-ui="vscode"] .phv-root[data-renderer-status="ready"]').first().waitFor({timeout: 90_000})
    // The tab reports its change count to the side bar (its row's badge); the renderer settles.
    await new Promise(resolve => {
      setTimeout(resolve, 5000)
    })
    if (shot.sideBySide) {
      await command(window, 'Projections: Comparison Mode…')
      await window.locator('.quick-input-title', {hasText: 'Comparison Mode'}).waitFor({timeout: 10_000})
      await window.keyboard.type('Side by Side')
      await window.locator('.quick-input-list .monaco-list-row', {hasText: 'Side by Side'}).first().waitFor()
      await window.keyboard.press('Enter')
      await frame.locator('.ph-panes > .ph-pane').nth(1).waitFor({timeout: 30_000})
      await frame.locator('.phv-root[data-renderer-status="ready"]').first().waitFor({timeout: 60_000})
      await new Promise(resolve => {
        setTimeout(resolve, 3000)
      })
    }
    if (shot.summaryBar) {
      // The summary bar along the tab's bottom, for a comparison (My branch) and then one revision (Current state),
      // cropped to the editor group and stacked into one picture.
      const bar = frame.locator('[data-summary-bar]').first()
      await bar.waitFor({timeout: 30_000})
      const renderer = frame.frameLocator('iframe.ph-frame').first()
      // Every count and finding is the bar's: the renderer draws no summary row over the graph.
      const rows = await renderer.locator('.graph-summary, .pk-diff-summary').count()
      if (rows) throw new Error(`The renderer draws ${rows} summary rows over the graph`)
      const crop = async () => {
        const box = await window.locator('.editor-group-container').first().boundingBox()
        return window.screenshot({clip: {x: box.x, y: box.y, width: box.width, height: box.height}})
      }
      const comparison = await crop()
      await sidebar.locator('.monaco-list-row', {hasText: 'Current state'}).first().click()
      for (let tries = 0; tries < 120 && /[+\u2212~]\d/u.test((await bar.getAttribute('data-sentence')) ?? '+1'); tries++) {
        await new Promise(resolve => {
          setTimeout(resolve, 500)
        })
      }
      await new Promise(resolve => {
        setTimeout(resolve, 3000)
      })
      const current = await crop()
      const browser = await chromium.launch()
      const page = await browser.newPage({deviceScaleFactor: 1})
      await page.setContent(
        `<body style="margin:0;display:inline-grid;gap:6px;background:${shot.kind === 'dark' ? '#111' : '#ccc'}">${[current, comparison]
          .map(image => `<img style="display:block;max-width:100%" src="data:image/png;base64,${image.toString('base64')}">`)
          .join('')}</body>`,
      )
      await page.locator('body').screenshot({path: join(output, `${shot.file}.png`)})
      await browser.close()
      console.log(shot.file)
      continue
    }
    if (shot.parts) {
      // Definition open on the tab's projection, its rows drawn with the part icons; the side bar, cropped.
      await section(sidebar, 'Viewing', false)
      await section(sidebar, 'Suggested', false)
      await section(sidebar, 'Definition', true)
      await sidebar.locator('.monaco-list-row', {hasText: 'Renderer'}).first().waitFor({timeout: 30_000})
      await window.mouse.move(900, 450)
      await new Promise(resolve => {
        setTimeout(resolve, 1000)
      })
      // From the Definition section's header to the next section's.
      const box = await sidebar.boundingBox()
      const top = (await header(sidebar, 'Definition').boundingBox()).y
      const bottom = (await header(sidebar, 'Suggested').boundingBox()).y
      await window.screenshot({path: join(output, `${shot.file}.png`), clip: {x: box.x, y: top, width: box.width, height: bottom - top}})
      console.log(shot.file)
      continue
    }
    if (shot.docs) {
      // A built-in row's documentation, inside VS Code: Definition with the Renderer row selected, the graph renderer's
      // bundled README in the Markdown preview beside the projection tab. On hover, a built-in row's inline Open
      // Documentation on GitHub (definition-open-on-github-dark), the one way to the browser.
      await section(sidebar, 'Viewing', false)
      await section(sidebar, 'Suggested', false)
      await section(sidebar, 'Definition', true)
      const definitionRow = label => sidebar.locator('.monaco-list-row', {hasText: label}).first()
      await definitionRow('Renderer').waitFor({timeout: 30_000})
      if (shot.github && wanted(shot.github)) {
        const comparator = definitionRow('Comparator')
        await comparator.hover()
        const action = comparator.locator('.action-label[aria-label="Open Documentation on GitHub"]')
        await action.waitFor({timeout: 10_000})
        await action.hover()
        await window
          .locator('.monaco-hover, .workbench-hover', {hasText: 'Open Documentation on GitHub'})
          .first()
          .waitFor({timeout: 10_000})
        await new Promise(resolve => {
          setTimeout(resolve, 500)
        })
        const box = await sidebar.boundingBox()
        const top = (await header(sidebar, 'Definition').boundingBox()).y
        const bottom = (await header(sidebar, 'Suggested').boundingBox()).y
        await window.screenshot({
          path: join(output, `${shot.github}.png`),
          clip: {x: box.x, y: top, width: box.width + 120, height: bottom - top},
        })
        console.log(shot.github)
      }
      await definitionRow('Renderer').click()
      const tab = window.locator('.tabs-container .tab', {hasText: 'graph.md'}).first()
      await tab.waitFor({timeout: 30_000})
      // The bundled page renders, in the preview's frame (its link to the kit's page tells it from the projection tab's).
      const heading = async () => {
        for (const candidate of window.frames()) {
          if (
            await candidate
              .locator('a[href="kit.md"]')
              .count()
              .catch(() => 0)
          ) {
            return candidate
          }
        }
        return undefined
      }
      let preview
      for (let tries = 0; tries < 60 && !(preview = await heading()); tries++) {
        await new Promise(resolve => {
          setTimeout(resolve, 500)
        })
      }
      if (!preview) throw new Error('The documentation preview did not render')
      await definitionRow('Renderer').click()
      await window.mouse.move(900, 450)
      await new Promise(resolve => {
        setTimeout(resolve, 1500)
      })
      if (wanted(shot.file)) {
        await window.screenshot({path: join(output, `${shot.file}.png`)})
        console.log(shot.file)
      }
      // A relative link in the page opens the bundled page it names in the preview, not the browser.
      await preview.locator('a[href="kit.md"]').first().click()
      await window.locator('.tabs-container .tab', {hasText: 'kit.md'}).first().waitFor({timeout: 30_000})
      console.log('A relative link opened kit.md in the preview')
      continue
    }
    // Nothing refreshes on its own: an edit makes the result out of date.
    const web = join(repository, 'packages', 'web', 'package.json')
    const original = await readFile(web, 'utf8')
    if (shot.edit) {
      const edited = JSON.parse(original)
      edited.dependencies['@demo/auth'] = '1.0.0'
      await writeFile(web, `${JSON.stringify(edited, null, 2)}\n`)
      await frame.locator('.phv-stage-notice').waitFor({timeout: 30_000})
      await sidebar
        .locator('.monaco-list-row', {hasText: /Packages.*Out of date/u})
        .first()
        .waitFor({timeout: 30_000})
      await new Promise(resolve => {
        setTimeout(resolve, 1000)
      })
    }
    const definitionPath = join(repository, '.github', 'projections', 'packages.json')
    const definition = await readFile(definitionPath, 'utf8')
    if (shot.definition) {
      // The edit makes the tab out of date; Refresh applies it, and the tab says "Your edits · Show committed".
      await writeFile(definitionPath, `${JSON.stringify({...JSON.parse(definition), title: 'Workspace packages'}, null, 2)}\n`)
      await frame.locator('.phv-stage-notice-action').click({timeout: 30_000})
      await frame.locator('.tp-edits[data-edits="yours"]').waitFor({timeout: 60_000})
      await frame.locator('.phv-root[data-renderer-status="ready"]').first().waitFor({timeout: 60_000})
      await sidebar
        .locator('.monaco-list-row', {hasText: /Packages.*edited/u})
        .first()
        .waitFor({timeout: 30_000})
      await new Promise(resolve => {
        setTimeout(resolve, 3000)
      })
    }
    if (shot.edit || shot.definition || shot.sideBySide) {
      // The row's inline Refresh shows on hover.
      await row.hover()
      await new Promise(resolve => {
        setTimeout(resolve, 500)
      })
      await window.screenshot({path: join(output, `${shot.file}.png`)})
      console.log(shot.file)
      if (shot.edit) await writeFile(web, original)
      if (shot.definition) await writeFile(definitionPath, definition)
      continue
    }
    // The four sections: Definition expanded (it opens collapsed), and Recent changes open, which checks the recent
    // commits with every projection.
    await section(sidebar, 'Definition', true)
    await sidebar.locator('.monaco-list-row', {hasText: 'Extractor'}).first().waitFor({timeout: 30_000})
    await sidebar.locator('.monaco-list-row', {hasText: 'Recent changes'}).first().click()
    await sidebar.locator('.monaco-list-row', {hasText: 'Add auth package'}).first().waitFor({timeout: 180_000})
    // The current row selected, as after a click on it (it changes nothing).
    await sidebar.locator('.monaco-list-row', {hasText: 'Branch changes'}).first().click()
    await new Promise(resolve => {
      setTimeout(resolve, 2000)
    })
    console.log(
      'Section title style:',
      await window.evaluate(() => {
        const title = document.querySelector('.part.sidebar .pane-header h3.title')
        return title ? `${title.textContent} · text-transform ${getComputedStyle(title).textTransform}` : 'none'
      }),
    )
    await window.mouse.move(900, 450)
    await new Promise(resolve => {
      setTimeout(resolve, 500)
    })
    if (wanted(shot.file)) {
      await window.screenshot({path: join(output, `${shot.file}.png`)})
      console.log(shot.file)
    }
    if (shot.collapsed && wanted(shot.collapsed)) {
      // Collapsed: the sections' titles are static; the status bar item names the choice.
      for (const title of ['Viewing', 'Projections', 'Definition', 'Suggested']) await section(sidebar, title, false)
      await new Promise(resolve => {
        setTimeout(resolve, 800)
      })
      await window.screenshot({path: join(output, `${shot.collapsed}.png`)})
      console.log(shot.collapsed)
      for (const title of ['Viewing', 'Projections']) await section(sidebar, title, true)
    }
    if (shot.testing && wanted(shot.testing)) {
      // The Testing view: the projection with its checks, and the test file no projection uses, after a run.
      await command(window, 'Test: Run All Tests')
      await command(window, 'View: Show Testing')
      await sideBarWidth(window, 300)
      const tests = window.locator('.part.sidebar')
      await tests.locator('.monaco-list-row', {hasText: 'Packages'}).first().waitFor({timeout: 60_000})
      await tests.locator('.monaco-list-row .codicon-testing-passed-icon').first().waitFor({timeout: 180_000})
      await new Promise(resolve => {
        setTimeout(resolve, 3000)
      })
      for (const label of ['Packages', 'first.comparator.test.yaml']) {
        const item = tests.locator('.monaco-list-row', {hasText: label}).first()
        if ((await item.getAttribute('aria-expanded')) === 'false') await item.locator('.monaco-tl-twistie').click()
      }
      await new Promise(resolve => {
        setTimeout(resolve, 1000)
      })
      await window.mouse.move(900, 450)
      await window.screenshot({path: join(output, `${shot.testing}.png`)})
      console.log(shot.testing)
    }
    if (shot.gutter && wanted(shot.gutter)) {
      // A comparator test file: each case has a run button (and its last result) in the gutter.
      await window.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P')
      await window.locator('.quick-input-widget input').fill('first.comparator.test.yaml')
      await window.locator('.quick-input-list .monaco-list-row', {hasText: 'first.comparator.test.yaml'}).first().waitFor()
      await window.keyboard.press('Enter')
      await window.locator('.monaco-editor [class*="codicon-testing"]').first().waitFor({timeout: 60_000})
      await new Promise(resolve => {
        setTimeout(resolve, 1500)
      })
      await window.mouse.move(900, 600)
      await window.screenshot({path: join(output, `${shot.gutter}.png`)})
      console.log(shot.gutter)
    }
  } catch (error) {
    // What the window showed when it failed, for debugging (not committed).
    await window.screenshot({path: `failed-${shot.file}.png`}).catch(noop)
    throw error
  } finally {
    await app.close()
  }
}
