// The Inspector's assets and renderer documents as a webview can use them: Blob URLs made from webview resources, and
// custom renderer bundles fetched through the extension, each with this page's nonce on its scripts.
import * as mount from '@githubnext/projections-inspector/mount'
import type {InspectorAssets} from '@githubnext/projections-inspector/mount'
import {hostTag, rendererTag} from '../protocol.js'
import type {RendererReply} from '../protocol.js'
import {config, fromExtension, post} from './host.js'

/** A renderer document with `nonce` on its script elements (parsed, so script text that mentions tags is untouched). */
export function withNonce(html: string, nonce: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  for (const script of document.querySelectorAll('script')) script.setAttribute('nonce', nonce)
  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response
}

/** A renderer document as a Blob URL, with this page's nonce on its scripts. */
const rendererDocument = (html: string) => URL.createObjectURL(new Blob([withNonce(html, config.nonce)], {type: 'text/html'}))

/**
 * The Inspector's assets as a webview can use them. A webview can't start a Worker from a resource URL (another
 * origin) and renderer frames, being sandboxed, can't load resource URLs, so Workers and renderer documents are
 * Blob URLs made from the resources, and the engine's Wasm modules are passed as bytes.
 */
export async function webviewAssets(): Promise<InspectorAssets> {
  const at = (path: string) => new URL(path, config.assets).href
  const blob = async (url: string, type: string) => URL.createObjectURL(new Blob([await (await fetchOk(url)).text()], {type}))
  const bytes = async (url: string) => new Uint8Array(await (await fetchOk(url)).arrayBuffer())
  const [engineWorker, comparatorWorker, engineWasm, defaultComparatorWasm] = await Promise.all([
    blob(config.engineWorker, 'text/javascript'),
    blob(config.comparatorWorker, 'text/javascript'),
    bytes(at('engine/engine.wasm')),
    bytes(at('engine/default-comparator.wasm')),
  ])
  return {
    engine: {workerUrl: engineWorker, wasm: {module: engineWasm}, comparator: {module: defaultComparatorWasm}},
    comparator: {workerUrl: comparatorWorker, rulesInterpreterUrl: at('comparator/rules.wasm')},
    async renderers() {
      try {
        const entries = await mount.loadRendererCatalog({base: at('renderers/')})
        return await Promise.all(
          entries.map(async entry => {
            // Each bundle is one self-contained document; its scripts get this page's nonce, which the policy it
            // inherits as a Blob document requires. Its own policy (no network, no frames) still applies.
            return {...entry, url: rendererDocument(await (await fetchOk(entry.url)).text())}
          }),
        )
      } catch (error) {
        console.error('Projections: built-in renderers are unavailable', error)
        return []
      }
    },
  }
}

/** Custom renderer bundles, fetched through the extension and opened as Blob documents with this page's nonce. */
export function customRenderers(): (url: URL) => Promise<string> {
  let next = 1
  const pending = new Map<number, {resolve: (url: string) => void; reject: (error: Error) => void}>()
  const documents = new Map<string, Promise<string>>()
  fromExtension(data => {
    const reply = data as Partial<RendererReply>
    if (reply?.tag !== rendererTag || typeof reply.id !== 'number') return
    const request = pending.get(reply.id)
    if (!request) return
    pending.delete(reply.id)
    if ('base64' in reply && typeof reply.base64 === 'string') {
      const bytes = Uint8Array.from(atob(reply.base64), character => character.charCodeAt(0))
      request.resolve(rendererDocument(new TextDecoder().decode(bytes)))
    } else request.reject(new Error('error' in reply ? String(reply.error) : 'The custom renderer is unavailable'))
  })
  return url => {
    const path = `${url.pathname}${url.search}`
    let document = documents.get(path)
    if (!document) {
      document = new Promise<string>((resolve, reject) => {
        const id = next++
        pending.set(id, {resolve, reject})
        post({tag: hostTag, op: 'rendererFile', id, path})
      })
      documents.set(path, document)
      // A failed fetch is tried again the next time the frame opens.
      document.catch(() => documents.delete(path))
    }
    return document
  }
}
