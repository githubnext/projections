// Captures review screenshots of key stories from the built Storybook, in light and dark, on desktop and a phone:
// `npm run screenshots -w @githubnext/projections-storybook -- [output directory] [name filter]` after `npm run build`.
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium, devices, webkit} from '@playwright/test'
import {startStorybookServer} from './serve.mjs'

const output = resolve(process.argv[2] ?? 'screenshots')
const only = process.argv[3]
const stories = {
  'default-explorer': 'default-ui-comparison-explorer--animated',
  'default-side-by-side': 'default-ui-comparison-explorer--side-by-side',
  'default-table': 'default-ui-comparison-explorer--annotations-and-details',
  'default-controls': 'default-ui-comparison-explorer--renderer-controls',
  'default-components': 'default-ui-components--forms',
  'core-stage': 'core-projection-stage--side-by-side',
}
await mkdir(output, {recursive: true})
const server = await startStorybookServer()
// Mobile uses WebKit: Chromium's mobile emulation leaves cross-origin frames blank in full-page captures.
const browsers = {desktop: await chromium.launch(), mobile: await webkit.launch()}
const viewports = {desktop: {viewport: {width: 1440, height: 1000}}, mobile: devices['iPhone 13']}
try {
  for (const [device, options] of Object.entries(viewports))
    for (const theme of ['light', 'dark'])
      for (const [scene, id] of Object.entries(stories)) {
        const name = `${device}-${theme}-${scene}`
        if (only && !name.includes(only)) continue
        const context = await browsers[device].newContext({...options, colorScheme: theme})
        const page = await context.newPage()
        await page.goto(`${server.url}iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`)
        await page.locator('body.sb-show-main').waitFor()
        await page.waitForFunction(
          () => !document.querySelector('.ph[data-renderer-status="loading"], .ph-explorer[data-outcome="computing"]'),
        )
        await page.waitForTimeout(800)
        await page.screenshot({path: `${output}/${name}.png`, fullPage: true})
        await context.close()
        console.log(name)
      }
} finally {
  for (const browser of Object.values(browsers)) await browser.close()
  await server.close()
}
