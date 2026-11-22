import type {InspectorChangeChannel} from './contract.js'

/** Whether `path` is a server-relative `/api/` path: no scheme, host, traversal or fragment. */
export function isApiPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 4096 &&
    path.startsWith('/api/') &&
    !path.includes('#') &&
    !path.includes('\\') &&
    !/(^|\/)\.\.?(\/|\?|$)/.test(path.split('?')[0]!) &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(path)
  )
}

/** Messages of the message transport (`createMessageTransport`), tagged so other traffic on the channel is ignored. */
export const transportTag = 'projections.inspector'

/**
 * A message from the UI to the bridge: a request (`id` pairs it with its reply), a change subscription, or an `abort`
 * of an earlier request by its `id`.
 */
export type TransportMessage =
  | {tag: typeof transportTag; type: 'request'; id: number; method: 'GET' | 'POST'; path: string; body?: unknown; responseType?: 'blob'}
  /** The change subscription (`InspectorTransport.next`), answered as a `response` like `GET /api/changes?since=`. */
  | {tag: typeof transportTag; type: 'next'; id: number; channel: InspectorChangeChannel; since: number}
  | {tag: typeof transportTag; type: 'abort'; id: number}
/** The bridge's reply to the `TransportMessage` with the same `id`: the runner's response, or why there is none. */
export type TransportReply =
  /** A `blob` request's successful body is `{type, base64}`. */
  | {tag: typeof transportTag; type: 'response'; id: number; status: number; body: unknown}
  /** The bridge could not reach the runner, or refused the request. */
  | {tag: typeof transportTag; type: 'failure'; id: number; message: string}

/** Validates a message a bridge received from the UI; anything else is ignored. */
export function parseTransportMessage(value: unknown): TransportMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const message = value as Record<string, unknown>
  if (message.tag !== transportTag || !Number.isSafeInteger(message.id)) return undefined
  if (message.type === 'abort') return {tag: transportTag, type: 'abort', id: message.id as number}
  if (message.type === 'next') {
    if (
      (message.channel !== 'changes' && message.channel !== 'fixtures') ||
      !Number.isSafeInteger(message.since) ||
      (message.since as number) < 0
    ) {
      return undefined
    }
    return {tag: transportTag, type: 'next', id: message.id as number, channel: message.channel, since: message.since as number}
  }
  if (message.type !== 'request' || (message.method !== 'GET' && message.method !== 'POST') || !isApiPath(message.path)) return undefined
  if (message.method === 'GET' && message.body !== undefined) return undefined
  if (message.responseType !== undefined && message.responseType !== 'blob') return undefined
  return {
    tag: transportTag,
    type: 'request',
    id: message.id as number,
    method: message.method,
    path: message.path,
    ...(message.body !== undefined ? {body: message.body} : {}),
    ...(message.responseType === 'blob' ? {responseType: 'blob' as const} : {}),
  }
}
