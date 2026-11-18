// A renderer's requests for built-in renderers' documents (`document-request`), and the host's answers (`document`).
import {rendererLimits, rendererNamePattern} from '../protocol.js'
import type {HostMessage, RendererMessage} from '../protocol.js'

type Answer = Extract<HostMessage, {type: 'document'}>

/**
 * The document requests of one connection: one per name, settled by the host's answer, a timeout or `dispose`. `error`
 * makes the rejection, so it is the client's own error type.
 */
export function documentRequests(view: Window, post: (message: RendererMessage) => void, error: (message: string) => Error) {
  const documents = new Map<string, {promise: Promise<string>; settle: (html: string | Error) => void}>()
  return {
    request(name: string): Promise<string> {
      const existing = documents.get(name)
      if (existing) return existing.promise
      if (!rendererNamePattern.test(name)) return Promise.reject(error(`Invalid renderer name: ${name}`))
      let settle!: (html: string | Error) => void
      const promise = new Promise<string>((resolve, reject) => {
        const timer = view.setTimeout(() => settle(error(`The host did not supply the ${name} renderer`)), rendererLimits.documentTimeoutMs)
        let settled = false
        settle = html => {
          if (settled) return
          settled = true
          view.clearTimeout(timer)
          if (typeof html === 'string') resolve(html)
          else {
            // A failed request may be asked again, for example after the host's registry loads.
            documents.delete(name)
            reject(html)
          }
        }
      })
      documents.set(name, {promise, settle})
      post({type: 'document-request', renderer: name})
      return promise
    },
    answer(message: Answer): void {
      documents.get(message.renderer)?.settle(message.html ?? error(message.error ?? 'No document'))
    },
    dispose(): void {
      for (const {settle} of documents.values()) settle(error('The renderer was disposed'))
    },
  }
}
