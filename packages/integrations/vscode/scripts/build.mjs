// Builds the extension (dist/extension.cjs), its comparator rules language service (the worker dist/rules-worker.cjs
// and dist/rules-editor.wasm, built from packages/comparators/rules/editor), the webview page (dist/webview.js: the mountable Inspector with the VS Code UI, one React instance), single-file engine
// and comparator Workers (dist/workers/, started from Blob URLs in the webview), copies the Inspector's client build
// (its stylesheet, Wasm and renderer bundles) to dist/inspector and the VS Code UI's stylesheets, codicon font and
// notices to dist/vscode-ui, and bundles the built-ins' documentation (dist/docs, scripts/docs.mjs), which the extension
// opens in VS Code's Markdown preview. Build the Inspector and the VS Code UI first.
import {build} from 'esbuild'
import {spawnSync} from 'node:child_process'
import {cp, rm, stat, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {bundleSchemas} from './schemas.mjs'
import {bundleDocs} from './docs.mjs'
import {inlineImports} from './inline-css.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const client = fileURLToPath(new URL('../../../host/inspector/dist/client/', import.meta.url))
try {
  await stat(`${client}mount.js`)
} catch {
  throw new Error('Build the Inspector first: its client build has no mount.js')
}
await rm(`${root}dist`, {recursive: true, force: true})
const common = {bundle: true, minify: true, sourcemap: false, legalComments: 'linked', logLevel: 'warning'}
await build({
  ...common,
  entryPoints: [`${root}src/extension.ts`],
  outfile: `${root}dist/extension.cjs`,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
})
// The comparator rules language service: rules-editor.wasm, which only the extension ships (viewers' rules.wasm doesn't
// carry it), and the worker thread that runs it (src/rules-worker.ts).
const editor = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('../../../comparators/rules/editor/scripts/build.mjs', import.meta.url))],
  {
    stdio: 'inherit',
  },
)
if (editor.error) throw editor.error
if (editor.status !== 0) process.exit(editor.status ?? 1)
for (const [from, to] of [
  ['rules-editor.wasm', 'rules-editor.wasm'],
  ['THIRD_PARTY_NOTICES.txt', 'LICENSE.rules-editor.txt'],
]) {
  await cp(fileURLToPath(new URL(`../../../comparators/rules/editor/dist/${from}`, import.meta.url)), `${root}dist/${to}`)
}
await build({
  ...common,
  entryPoints: [`${root}src/rules-worker.ts`],
  outfile: `${root}dist/rules-worker.cjs`,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
})
await build({
  ...common,
  entryPoints: [`${root}src/webview/main.ts`],
  outfile: `${root}dist/webview.js`,
  platform: 'browser',
  format: 'esm',
  target: 'chrome120',
})
for (const [name, entry] of [
  ['engine', `${client}engine/worker-entry.js`],
  ['comparator', `${client}comparator/worker-entry.js`],
]) {
  await build({
    ...common,
    entryPoints: [entry],
    outfile: `${root}dist/workers/${name}.js`,
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
  })
}
await cp(client, `${root}dist/inspector`, {recursive: true})
const vscodeUi = fileURLToPath(new URL('./', import.meta.resolve('@githubnext/projections-host-vscode/package.json')))
for (const [from, to] of [
  ['src/inspector.css', 'inspector.css'],
  ['dist/codicons', 'codicons'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
]) {
  await cp(`${vscodeUi}${from}`, `${root}dist/vscode-ui/${to}`, {recursive: true})
}
// The stylesheet's parts, inlined: the webview links one file.
await writeFile(`${root}dist/vscode-ui/styles.css`, await inlineImports(`${vscodeUi}src/styles.css`))
// The JSON Schemas, for offline validation of definitions (`jsonValidation`) and rules files (`yamlValidation`).
await bundleSchemas(fileURLToPath(new URL('../../../schemas/schemas/', import.meta.url)), `${root}dist/schemas`)
// The built-in parts' documentation, opened in VS Code's Markdown preview rather than the browser.
await bundleDocs(fileURLToPath(new URL('../../../../', import.meta.url)), `${root}dist/docs`)
