import {InspectorRequestError} from './contract.js'
import type {InspectorChangeChannel, InspectorTransport} from './contract.js'
import {requestErrorMessage} from './errors.js'
import {isApiPath, transportTag} from './messages.js'
import type {TransportMessage, TransportReply} from './messages.js'

/**
 * A transport over a message channel, such as an editor webview's `postMessage` to its extension. The other end (a
 * bridge) proxies each request to the runner, adding the startup token itself, so the UI holds no token and needs no
 * network access. Aborting a request tells the bridge to abort it too.
 */
export function createMessageTransport({
  post,
  listen,
  origin,
  subscriptions = false,
}: {
  post: (message: TransportMessage) => void
  /** Subscribes to messages from the bridge; returns an unsubscribe function. */
  listen: (listener: (message: unknown) => void) => () => void
  /** What server-relative URLs resolve against; the embedding document's origin by default. */
  origin?: string
  /** The bridge answers `next` messages from the runner's change notifications, so changes aren't long-polled. */
  subscriptions?: boolean
}): InspectorTransport & {dispose(): void} {
  let nextId = 1
  const pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void; blob: boolean}>()
  const stop = listen(value => {
    if (typeof value !== 'object' || value === null) return
    const reply = value as Partial<TransportReply>
    if (reply.tag !== transportTag || typeof reply.id !== 'number') return
    const request = pending.get(reply.id)
    if (!request) return
    pending.delete(reply.id)
    if (reply.type === 'response' && typeof reply.status === 'number') {
      if (reply.status >= 200 && reply.status < 300) {
        if (!request.blob) request.resolve(reply.body)
        else {
          const {type, base64} = (reply.body ?? {}) as {type?: unknown; base64?: unknown}
          if (typeof type !== 'string' || typeof base64 !== 'string')
            request.reject(new Error('The Inspector bridge returned an invalid binary body'))
          else request.resolve(new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], {type}))
        }
      } else request.reject(new InspectorRequestError(requestErrorMessage(reply.status, reply.body), reply.status))
    } else if (reply.type === 'failure') request.reject(new Error(String(reply.message ?? 'The Inspector bridge failed')))
  })
  /** Posts `message` (with a fresh id) and settles with its reply, or rejects when `signal` aborts. */
  function send(message: (id: number) => TransportMessage, blob: boolean, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    const id = nextId++
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (!pending.delete(id)) return
        post({tag: transportTag, type: 'abort', id})
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      }
      pending.set(id, {
        blob,
        resolve: value => {
          signal?.removeEventListener('abort', abort)
          resolve(value)
        },
        reject: error => {
          signal?.removeEventListener('abort', abort)
          reject(error)
        },
      })
      signal?.addEventListener('abort', abort, {once: true})
      post(message(id))
    })
  }
  return {
    origin: origin ?? globalThis.location?.origin ?? 'null',
    request({method, path, body, signal, responseType}) {
      if (!isApiPath(path)) return Promise.reject(new Error(`Not an Inspector API path: ${String(path).slice(0, 200)}`))
      return send(
        id => ({
          tag: transportTag,
          type: 'request',
          id,
          method,
          path,
          ...(body !== undefined ? {body} : {}),
          ...(responseType === 'blob' ? {responseType} : {}),
        }),
        responseType === 'blob',
        signal,
      )
    },
    ...(subscriptions
      ? {
          next: (channel: InspectorChangeChannel, since: number, signal?: AbortSignal) =>
            send(id => ({tag: transportTag, type: 'next', id, channel, since}), false, signal),
        }
      : {}),
    dispose() {
      stop()
      for (const request of pending.values()) request.reject(new Error('The Inspector transport was closed'))
      pending.clear()
    },
  }
}
