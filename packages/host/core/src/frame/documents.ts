import {rendererMetaContentSecurityPolicy} from '@githubnext/projections-renderer-sdk/protocol'

/**
 * Renderer documents a page opens itself, as Blob URLs. Some embedding browsers refuse to load a renderer's URL into
 * its sandboxed frame: Claude Code's Preview pane cancels any request from an opaque origin to a loopback address, so a
 * viewer on `127.0.0.1` can't load its own renderer frames there. The page can still fetch the renderer document and
 * open it as a Blob document in the same sandboxed frame. The frame keeps its sandbox (an opaque origin, scripts only)
 * and the document gets the renderer policy as its first `<meta>` element; it also inherits the page's policy, which must
 * admit its scripts by the nonce stamped on them and everything else the renderer policy grants (`blob:` frames for the
 * page, `data:` fonts and media, `blob:` workers and media).
 */

/** Opens the renderer document at a URL as a Blob URL (without the fragment), or fails. */
export type RendererDocumentOpener = (url: URL) => Promise<string>

/**
 * A renderer document as a page opens it itself: the renderer policy first in its head, so it governs everything after
 * it whatever the bundle's own metadata says (policies only ever narrow), and `nonce` on its script elements (parsed,
 * so script text that mentions tags is untouched). It stands in for the policy the bundle's response would carry, which
 * a Blob document has no headers for; the frame's `sandbox` attribute stands in for that policy's `sandbox` directive.
 */
export function rendererDocumentHtml(html: string, nonce: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html')
  for (const script of document.querySelectorAll('script')) script.setAttribute('nonce', nonce)
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = rendererMetaContentSecurityPolicy
  document.head.prepend(policy)
  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

/** A renderer document as a Blob URL, under the renderer policy and with `nonce` on its scripts. */
export const rendererBlobDocument = (html: string, nonce: string): string =>
  URL.createObjectURL(new Blob([rendererDocumentHtml(html, nonce)], {type: 'text/html'}))

/**
 * An opener that fetches the renderer document from the page's own origin and opens it with the page's script
 * `nonce`. Only same-origin HTML documents are opened.
 */
export function fetchedRendererDocuments(nonce: string, view: Window = globalThis): RendererDocumentOpener {
  return async url => {
    if (url.origin !== view.location.origin) throw new Error(`${url.origin} is not this page's origin`)
    const response = await view.fetch(new URL(`${url.pathname}${url.search}`, url.origin), {credentials: 'omit'})
    if (!response.ok) throw new Error(`${url.pathname} returned ${response.status}`)
    if (!(response.headers.get('content-type') ?? '').startsWith('text/html')) throw new Error(`${url.pathname} is not a document`)
    return rendererBlobDocument(await response.text(), nonce)
  }
}

let pageOpener: RendererDocumentOpener | undefined
let opensFirst = false

/**
 * Sets how renderer frames on this page open a renderer's document themselves when its URL doesn't reach the
 * renderer (see `RendererFrameOptions.documents`); `undefined` stops. Once a frame's renderer has started from such a
 * document, later frames open theirs that way from the start.
 */
export function setRendererDocuments(opener: RendererDocumentOpener | undefined): void {
  pageOpener = opener
  opensFirst = false
}

/** The page's opener, and whether frames should use it from the start. */
export const pageRendererDocuments = () => ({opener: pageOpener, first: opensFirst})

/** A frame's renderer started from a document its page opened. */
export function openedDocumentWorked(opener: RendererDocumentOpener): void {
  if (opener === pageOpener) opensFirst = true
}
