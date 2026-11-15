// Copies what tsdown doesn't build into the package: the SDK's icon tokens; the kit's stylesheets, `base.css` (its
// import of the icons rewritten to this package's copy) and `react.css` (which imports `base.css`), each with its
// partials inlined in order; and the SDK's vendored linguist data with its license and `vendor.json`.
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const sdk = new URL('../../renderers/sdk/', import.meta.url)
const kit = new URL('../../renderers/kit/', import.meta.url)
await mkdir(`${root}dist/renderer`, {recursive: true})
await mkdir(`${root}dist/kit`, {recursive: true})
await cp(new URL('icons.css', sdk), `${root}dist/renderer/icons.css`)

/** The kit stylesheet `name` with its partials (`styles/*.css`) inlined where it imports them. */
async function inlined(name) {
  const entry = await readFile(new URL(name, kit), 'utf8')
  const partials = /^@import '\.\/(styles\/[a-z-]+\.css)';\n/gm
  const styles = (
    await Promise.all(entry.split(partials).map((part, index) => (index % 2 ? readFile(new URL(part, kit), 'utf8') : part)))
  ).join('')
  if (/^@import '\.\/(?!base\.css')/m.test(styles)) throw new Error(`The kit's ${name} imports a file this script doesn't inline`)
  return styles
}

const icons = "@import '@githubnext/projections-renderer-sdk/icons.css';"
const base = await inlined('base.css')
if (!base.startsWith(icons)) throw new Error(`The kit's base.css no longer starts with ${icons}`)
await writeFile(`${root}dist/kit/base.css`, base.replace(icons, "@import '../renderer/icons.css';"))
const react = await inlined('react.css')
if (!react.includes("@import './base.css';")) throw new Error("The kit's react.css no longer imports base.css")
await writeFile(`${root}dist/kit/react.css`, react)
await cp(new URL('vendor/linguist/', sdk), `${root}vendor/linguist/`, {recursive: true})
