import {fetchedRendererDocuments, setRendererDocuments} from '@githubnext/projections-host'

/**
 * Lets renderer frames open their documents from this page, where a browser won't load a renderer's URL into its
 * sandboxed frame (Claude Code's Preview pane refuses loopback requests from opaque origins), when the page is
 * `projections view`'s own: its policy admits renderer documents stamped with the script nonce it gave the page.
 * Returns a function that stops.
 */
export function openRendererDocuments(served: boolean): () => void {
  const nonce = served ? document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce : undefined
  if (!nonce) return () => {}
  setRendererDocuments(fetchedRendererDocuments(nonce))
  return () => setRendererDocuments(undefined)
}
