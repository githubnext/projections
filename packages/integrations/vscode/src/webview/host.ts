// The page's link to the extension: VS Code's webview API (acquired once, as VS Code allows), the configuration the
// extension wrote into the page, and messages both ways.
import type {HostMessage, WebviewConfig} from '../protocol.js'

declare function acquireVsCodeApi(): {postMessage: (message: unknown) => void; getState: () => unknown; setState: (state: unknown) => void}

export const vscode = acquireVsCodeApi()

export const config = JSON.parse(document.getElementById('projections-config')!.textContent) as WebviewConfig

export const post = (message: HostMessage) => vscode.postMessage(message)

/**
 * Messages from the extension, which VS Code delivers from this webview's own origin. Renderer frames post to this
 * window too, from their opaque origin (`null`), so they can't pose as the extension.
 */
export function fromExtension(listener: (data: unknown) => void): () => void {
  const handler = (event: MessageEvent) => {
    if (event.origin !== location.origin) return
    listener(event.data)
  }
  addEventListener('message', handler)
  return () => removeEventListener('message', handler)
}
