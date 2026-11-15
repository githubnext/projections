// Screenshots of the Inspector with the VS Code UI in real VS Code (dark, light and high contrast dark, 1440×900), and
// side by side comparisons with the screenshots of real VS Code captured with the theme fixtures (the Inspector before
// the VS Code UI), for docs/design/images/desktop-surfaces/.
//   node scripts/screenshots/screenshots.mjs [output directory]
import {chromium} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createDemoRepository} from '../../test/smoke/demo-repo.mjs'
import {cli, command, inspectorFrame, launch} from './electron.mjs'

const output = process.argv[2] ?? fileURLToPath(new URL('../../../../../docs/design/images/desktop-surfaces/', import.meta.url))
const fixtures = fileURLToPath(new URL('../../../../host/vscode-ui/fixtures/themes/', import.meta.url))
const shots = [
  {file: 'vscode-dark', fixture: 'dark-modern', theme: 'Default Dark Modern', kind: 'dark', label: 'Dark Modern'},
  {file: 'vscode-light', fixture: 'light-modern', theme: 'Default Light Modern', kind: 'light', label: 'Light Modern'},
  {file: 'vscode-hc-dark', fixture: 'dark-high-contrast', theme: 'Default High Contrast', kind: 'hc-dark', label: 'Dark High Contrast'},
]
const only = process.argv[3]?.split(',')
const repository = await createDemoRepository(cli)
for (const shot of shots.filter(item => !only || only.includes(item.file))) {
  const {app, window} = await launch({repository, theme: shot.theme, kind: shot.kind})
  try {
    await command(window, 'Projections: Open Inspector')
    const frame = await inspectorFrame(window)
    await frame.locator('[data-host-ui="vscode"] .phv-root[data-renderer-status="ready"]').first().waitFor({timeout: 90_000})
    // Renderer layout and the toolbar's measured layout settle.
    await new Promise(resolve => setTimeout(resolve, 4000))
    await window.screenshot({path: join(output, `${shot.file}.png`)})
    console.log(shot.file)
  } finally {
    await app.close()
  }
}

// The Explore view in Dark Modern: the candidates, swept across the recent changes, with Adopt and Add to CI.
if (!only || only.includes('vscode-explore-dark')) {
  const {app, window} = await launch({repository, theme: 'Default Dark Modern', kind: 'dark'})
  try {
    await command(window, 'Projections: Explore Repository')
    const frame = await inspectorFrame(window)
    await frame.locator('[data-candidate]').first().waitFor({timeout: 90_000})
    await frame.locator('section[aria-labelledby="pi-sweep-title"] form button[type="submit"]').click()
    await frame.locator('td.pi-sweep-cell').first().waitFor({timeout: 120_000})
    await frame.locator('section[aria-labelledby="pi-sweep-title"] form button[type="submit"]:not([disabled])').waitFor({timeout: 120_000})
    // Thumbnails render one at a time.
    await new Promise(resolve => setTimeout(resolve, 8000))
    await window.screenshot({path: join(output, 'vscode-explore-dark.png')})
    console.log('vscode-explore-dark')
  } finally {
    await app.close()
  }
}

// Each comparison: real VS Code with the Inspector before the VS Code UI (the fixture's screenshot), and with it.
const browser = await chromium.launch()
try {
  const page = await browser.newPage({viewport: {width: 2928, height: 1000}})
  for (const shot of shots.filter(item => !only || only.includes(item.file))) {
    const image = async path => `data:image/png;base64,${(await readFile(path)).toString('base64')}`
    const before = await image(join(fixtures, `${shot.fixture}.vscode.png`))
    const after = await image(join(output, `${shot.file}.png`))
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#1e1e1e;color:#ccc;font:600 20px -apple-system,'Segoe UI',sans-serif">
      <div style="display:grid;grid-template-columns:1440px 1440px;gap:16px;padding:16px">
        <figure style="margin:0"><figcaption style="margin-bottom:12px">VS Code, ${shot.label}: the Inspector's default UI</figcaption><img src="${before}" width="1440" height="900"></figure>
        <figure style="margin:0"><figcaption style="margin-bottom:12px">VS Code, ${shot.label}: the VS Code UI</figcaption><img src="${after}" width="1440" height="900"></figure>
      </div></body></html>`)
    await page.screenshot({path: join(output, `vscode-compare-${shot.file.replace('vscode-', '')}.png`), fullPage: true})
    console.log(`vscode-compare-${shot.file.replace('vscode-', '')}`)
  }
} finally {
  await browser.close()
}
