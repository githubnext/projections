// Renders the extension's Marketplace icon (media/icon.png, 256×256; the Marketplace takes no SVG) from the brand's
// app icon (brand/projections-app-icon.svg) in headless Chromium. Run it again when the app icon changes.
import {chromium} from 'playwright'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const svg = await readFile(fileURLToPath(new URL('../../../../brand/projections-app-icon.svg', import.meta.url)), 'utf8')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({viewport: {width: 256, height: 256}, deviceScaleFactor: 1})
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:256px;height:256px}</style>${svg}`,
  )
  await page.screenshot({path: fileURLToPath(new URL('../media/icon.png', import.meta.url)), omitBackground: true})
} finally {
  await browser.close()
}
