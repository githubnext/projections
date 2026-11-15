// Builds the viewer's MCP App page (dist/viewer.html): one self-contained HTML document, as MCP Apps hosts take a view,
// with everything inline because the host's sandbox gives it no URL to load anything from. The page's script (src/,
// with the Inspector's viewer and React), the Inspector's stylesheet, the engine and comparator Workers as single
// scripts, the Wasm modules and the built-in renderer bundles, from the Inspector's client build. The script and
// assets are gzip-compressed (a third of their size): a small inline script inflates the page's script and imports it
// as a Blob module, and the page inflates the rest. The CLI embeds it (packages/cli/build.rs). Build the Inspector
// first.
import {build} from 'esbuild'
import {gzipSync} from 'node:zlib'
import {mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const client = fileURLToPath(new URL('../../../host/inspector/dist/client/', import.meta.url))
try {
  await stat(`${client}mount.css`)
} catch {
  throw new Error('Build the Inspector first: its client build has no mount.css')
}
const common = {
  bundle: true,
  minify: true,
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
  platform: 'browser',
  target: ['chrome120', 'safari17'],
}
const script = async (entry, options) => (await build({...common, entryPoints: [entry], ...options})).outputFiles[0].text
// The Workers are classic scripts: Chromium won't start a module Worker from a Blob URL in an opaque-origin document,
// which is what a host's sandbox makes the view (src/workers.ts), and gives them SHA-256 where that Worker has no
// `crypto.subtle` (src/digest.ts). Their default module URLs go unused: the page passes the Wasm modules as bytes.
const classic = {format: 'iife', define: {'import.meta.url': 'self.location.href'}}

const [main, engineWorker, comparatorWorker] = await Promise.all([
  script(`${root}src/main.ts`, {format: 'esm'}),
  script(`${root}src/engine-worker.ts`, classic),
  script(`${root}src/comparator-worker.ts`, classic),
])
/** Inline content: gzip, then base64. */
const pack = content => gzipSync(content, {level: 9}).toString('base64')
const file = async path => pack(await readFile(`${client}${path}`))
/** `renderers/`: its catalog and each bundle's document. */
async function renderers() {
  const files = {'index.json': await file('renderers/index.json')}
  for (const entry of await readdir(`${client}renderers`, {withFileTypes: true}))
    if (entry.isDirectory()) files[`${entry.name}/index.html`] = await file(`renderers/${entry.name}/index.html`)
  return files
}
const assets = {
  main: pack(main),
  engineWorker: pack(engineWorker),
  comparatorWorker: pack(comparatorWorker),
  engineWasm: await file('engine/engine.wasm'),
  defaultComparatorWasm: await file('engine/default-comparator.wasm'),
  rulesWasm: await file('comparator/rules.wasm'),
  renderers: await renderers(),
}
const css = await readFile(`${client}mount.css`, 'utf8')
// Inline text must not close its element early: base64 and JSON have no `<`, and the stylesheet mustn't close its own.
const json = JSON.stringify(assets)
if (json.includes('<')) throw new Error('The inline assets contain <')
if (/<\/style/i.test(css)) throw new Error('The stylesheet contains </style')
/** Inflates the page's script and runs it; says why where it can't. */
const bootstrap = `const assets = JSON.parse(document.getElementById('projections-assets').textContent)
const bytes = Uint8Array.from(atob(assets.main), c => c.charCodeAt(0))
new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
  .then(source => import(URL.createObjectURL(new Blob([source], {type: 'text/javascript'}))))
  .catch(error => { document.getElementById('root').textContent = 'Could not start the Projections viewer: ' + error })`
// The page fills the host's frame; main.ts sets its height for where the host shows it.
const frame = 'html,body,#root{margin:0;height:100%}html{overflow:hidden}'
const html =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="color-scheme" content="light dark"><meta name="referrer" content="no-referrer"><title>Projections</title>' +
  `<style>${css}\n${frame}</style></head><body><div id="root"></div>` +
  `<script type="application/json" id="projections-assets">${json}</script>` +
  `<script type="module">${bootstrap}</script></body></html>\n`
await mkdir(`${root}dist`, {recursive: true})
await writeFile(`${root}dist/viewer.html`, html)
console.log(`dist/viewer.html: ${(html.length / 1024 / 1024).toFixed(1)} MB`)
