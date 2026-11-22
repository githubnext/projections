import {parseTransportMessage, transportTag} from '@githubnext/projections-inspector/transport'
import type {TransportReply} from '@githubnext/projections-inspector/transport'
import {customRendererPath, relayed, rendererFileOf, workspaceChanges} from './bridge/responses.ts'
import type {Relayed, RendererFile, WorkspaceChanges} from './bridge/responses.ts'
import type {Runner} from './runner.js'

/** How long a change subscription waits before answering that nothing changed, as `GET /api/changes` does. */
export const changeWaitMs = 20_000

/**
 * The extension side of the webview's message transport. It accepts only `/api/` requests (see
 * `parseTransportMessage`), sends each to the `projections serve --stdio` backend as a JSON-RPC `request`, cancels it
 * when the webview aborts, and relays the status and body. It answers change subscriptions (`next`) from the
 * backend's `changes` notifications, so the webview doesn't long-poll, and fetches custom renderer bundle files for
 * the webview to open as Blob documents. The webview never reaches the backend or the network.
 */
export function createBridge(
  runner: Pick<Runner, 'request'> & Partial<Pick<Runner, 'onNotification'>>,
  reply: (message: TransportReply) => void,
  {waitMs = changeWaitMs, onRequest}: {waitMs?: number; onRequest?: (method: 'GET' | 'POST', path: string) => void} = {},
) {
  const inflight = new Map<number, AbortController>()
  /** The latest working-tree generation the backend reported, and the subscriptions waiting past it. */
  let latest: number | undefined
  const waiting = new Set<{since: number; settle: (changes: WorkspaceChanges | undefined) => void}>()
  const unsubscribe = runner.onNotification?.((method, params) => {
    const changes = method === 'changes' ? workspaceChanges(params) : undefined
    if (!changes) return
    const previous = latest
    latest = Math.max(latest ?? 0, changes.generation)
    for (const waiter of waiting) {
      if (changes.generation <= waiter.since) continue
      waiting.delete(waiter)
      // A notification covers the changes since the generation before it; otherwise the backend answers at once.
      waiter.settle(previous === waiter.since ? changes : undefined)
    }
  })

  function settle(id: number, abort: AbortController, message: Relayed) {
    if (inflight.get(id) !== abort) return
    inflight.delete(id)
    reply({tag: transportTag, id, ...message} as TransportReply)
  }
  function relay(id: number, abort: AbortController, method: 'GET' | 'POST', path: string, body: unknown, blob: boolean) {
    runner.request({method, path, ...(body === undefined ? {} : {body})}, abort.signal).then(
      response => settle(id, abort, relayed(response, blob)),
      (error: unknown) => {
        if (!abort.signal.aborted) {
          settle(id, abort, {
            type: 'failure',
            message: `The Projections backend failed: ${error instanceof Error ? error.message : String(error)}`,
          })
        }
      },
    )
  }
  function forward(id: number, method: 'GET' | 'POST', path: string, body: unknown, blob: boolean) {
    const abort = new AbortController()
    inflight.set(id, abort)
    relay(id, abort, method, path, body, blob)
  }
  /** The next working-tree change after `since`: from the notifications, or at once from the backend when it is behind. */
  async function next(id: number, channel: 'changes' | 'fixtures', since: number) {
    if (channel !== 'changes' || !runner.onNotification) {
      forward(id, 'GET', `${channel === 'fixtures' ? '/api/fixtures/changes' : '/api/changes'}?since=${since}`, undefined, false)
      return
    }
    const abort = new AbortController()
    inflight.set(id, abort)
    const answer = () => relay(id, abort, 'GET', `/api/changes?since=${since}`, undefined, false)
    if (latest === undefined) {
      // The current generation, which `since=0` returns at once.
      try {
        const current = workspaceChanges((await runner.request({method: 'GET', path: '/api/changes?since=0'}, abort.signal)).body)
        if (current) latest = Math.max(latest ?? 0, current.generation)
      } catch {
        // The answer below reports the failure.
      }
      if (abort.signal.aborted) return
    }
    if (latest !== since) return answer()
    const waiter = {since, settle: finish}
    const timer = setTimeout(() => {
      waiting.delete(waiter)
      abort.signal.removeEventListener('abort', cancel)
      settle(id, abort, {type: 'response', status: 200, body: {generation: since, changes: [], complete: true}})
    }, waitMs)
    function finish(changes: WorkspaceChanges | undefined) {
      clearTimeout(timer)
      abort.signal.removeEventListener('abort', cancel)
      if (changes) settle(id, abort, {type: 'response', status: 200, body: changes})
      else answer()
    }
    function cancel() {
      waiting.delete(waiter)
      clearTimeout(timer)
    }
    abort.signal.addEventListener('abort', cancel, {once: true})
    waiting.add(waiter)
  }
  return {
    /** Handles one message from the webview; anything that isn't a valid transport message is ignored. */
    receive(value: unknown): boolean {
      const message = parseTransportMessage(value)
      if (!message) return false
      if (message.type === 'abort') {
        inflight.get(message.id)?.abort()
        inflight.delete(message.id)
        return true
      }
      if (message.type === 'next') void next(message.id, message.channel, message.since)
      else {
        onRequest?.(message.method, message.path)
        forward(message.id, message.method, message.path, message.body, message.responseType === 'blob')
      }
      return true
    },
    /** A custom renderer bundle file (`/custom-renderers/…`), for the webview to open as a Blob document. */
    async rendererFile(path: unknown): Promise<RendererFile> {
      if (!customRendererPath(path)) return {error: 'Not a custom renderer path'}
      try {
        return rendererFileOf(await runner.request({method: 'GET', path}))
      } catch (error) {
        return {error: error instanceof Error ? error.message : String(error)}
      }
    },
    dispose() {
      unsubscribe?.()
      // Aborting each subscription also stops its wait.
      for (const abort of inflight.values()) abort.abort()
      inflight.clear()
    },
  }
}
