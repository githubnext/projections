// The Inspector's assets, inline in the page: the host's sandbox gives the view no URL to load them from, so the build
// writes them into the page (`<script type="application/json" id="projections-assets">`), and the view makes the
// Workers and renderer documents Blob URLs and passes the Wasm modules as bytes, as an editor webview does.
import {loadRendererCatalog} from '@githubnext/projections-inspector/mount'
import type {InspectorAssets} from '@githubnext/projections-inspector/mount'
import {classicWorkers} from './workers.js'

/**
 * What the build inlines, each gzip-compressed and base64-encoded: the Worker scripts, the Wasm modules and the
 * built-in renderers' files by path.
 */
export interface InlineAssets {
  engineWorker: string
  comparatorWorker: string
  engineWasm: string
  defaultComparatorWasm: string
  rulesWasm: string
  /** `renderers/` as the Inspector's build lays it out: `index.json` and each bundle's `<name>/index.html`. */
  renderers: Record<string, string>
}

/** Where the built-in renderer catalog seems to be, for `loadRendererCatalog`: never fetched. */
const catalogBase = 'https://projections-assets.invalid/renderers/'

/** An inline asset's bytes: base64, then gzip. */
export async function inflate(base64: string): Promise<Uint8Array<ArrayBuffer>> {
  const compressed = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
const text = async (base64: string) => new TextDecoder().decode(await inflate(base64))
const blobUrl = (content: BlobPart, type: string) => URL.createObjectURL(new Blob([content], {type}))

/** The inline assets the build wrote into the page. */
export function readInlineAssets(doc: Document = document): InlineAssets {
  const source = doc.getElementById('projections-assets')?.textContent
  if (!source) throw new Error("This page has no Inspector assets: it wasn't built")
  return JSON.parse(source) as InlineAssets
}

/** The Inspector's assets from the inline ones: Workers (classic) and renderer documents as Blob URLs, Wasm as bytes. */
export async function inlineAssets(inline: InlineAssets): Promise<InspectorAssets> {
  const [engineWorker, comparatorWorker, engineWasm, defaultComparatorWasm, rulesWasm] = await Promise.all([
    text(inline.engineWorker),
    text(inline.comparatorWorker),
    inflate(inline.engineWasm),
    inflate(inline.defaultComparatorWasm),
    inflate(inline.rulesWasm),
  ])
  const workers = [blobUrl(engineWorker, 'text/javascript'), blobUrl(comparatorWorker, 'text/javascript')] as const
  classicWorkers(workers)
  return {
    engine: {
      workerUrl: workers[0],
      wasm: {module: engineWasm},
      comparator: {module: defaultComparatorWasm},
    },
    comparator: {workerUrl: workers[1], rulesInterpreterUrl: blobUrl(rulesWasm, 'application/wasm')},
    async renderers() {
      const file = (url: URL) => (url.href.startsWith(catalogBase) ? inline.renderers[url.href.slice(catalogBase.length)] : undefined)
      try {
        const entries = await loadRendererCatalog({
          base: catalogBase,
          fetch: async input => {
            const content = file(new URL(String(input instanceof Request ? input.url : input)))
            return content === undefined ? new Response(null, {status: 404}) : new Response(await text(content))
          },
        })
        const documents = await Promise.all(
          entries.map(async entry => {
            const html = file(new URL(entry.url))
            return html === undefined ? [] : [{...entry, url: blobUrl(await text(html), 'text/html')}]
          }),
        )
        return documents.flat()
      } catch (error) {
        console.error('Projections: built-in renderers are unavailable', error)
        return []
      }
    },
  }
}
