import type {RunnerResponse} from '../runner.ts'

/** The largest backend response the bridge relays (an extraction or comparison document, base64 comparator rules). */
export const maxResponseBytes = 64 * 1024 * 1024

/** The working-tree changes since a generation, as `GET /api/changes?since=` and the `changes` notification carry them. */
export interface WorkspaceChanges {
  generation: number
  changes: string[]
  complete: boolean
}

export function workspaceChanges(value: unknown): WorkspaceChanges | undefined {
  const changes = value as Partial<WorkspaceChanges> | null
  return changes && Number.isSafeInteger(changes.generation) && Array.isArray(changes.changes) && typeof changes.complete === 'boolean'
    ? (changes as WorkspaceChanges)
    : undefined
}

/** A custom renderer bundle file's path: `/custom-renderers/…`, server-relative, without traversal or fragments. */
export function customRendererPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length <= 4096 &&
    path.startsWith('/custom-renderers/') &&
    !path.includes('#') &&
    !path.includes('\\') &&
    !/(^|\/)\.\.?(\/|\?|$)/.test(path.split('?')[0]!) &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(path)
  )
}

/** A custom renderer bundle file the bridge fetched: its content type and bytes, or why it couldn't. */
export type RendererFile = {type: string; base64: string} | {error: string}

/** A relayed request's reply to the webview: a response, or a failure. */
export type Relayed = {type: 'response'; status: number; body: unknown} | {type: 'failure'; message: string}

const bodyText = (body: unknown) => (typeof body === 'string' ? body : JSON.stringify(body ?? ''))

/**
 * What the webview gets for a backend response: a blob's type and base64 bytes, a JSON body, or an error's text (cut
 * at 2 KiB); a failure when it is too large or a success isn't JSON.
 */
export function relayed(response: RunnerResponse, blob: boolean): Relayed {
  const {status, contentType} = response
  const base64 = (response.body as {base64?: unknown} | null)?.base64
  const encoded = typeof base64 === 'string' ? base64 : Buffer.from(bodyText(response.body)).toString('base64')
  const bytes = typeof base64 === 'string' ? Buffer.byteLength(base64, 'base64') : response.size
  if (bytes > maxResponseBytes) return {type: 'failure', message: 'The backend response exceeds the bridge limit'}
  if (status >= 200 && status < 300 && blob) return {type: 'response', status, body: {type: contentType, base64: encoded}}
  if (status >= 200 && status < 300) {
    return /^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType)
      ? {type: 'response', status, body: response.body}
      : {type: 'failure', message: 'The backend returned invalid JSON'}
  }
  return {type: 'response', status, body: bodyText(response.body).slice(0, 2048)}
}

/** A custom renderer bundle file from the backend's response, or why it is unavailable. */
export function rendererFileOf(response: RunnerResponse): RendererFile {
  if (response.status !== 200) {
    return {error: `The custom renderer is unavailable (${response.status}): ${bodyText(response.body).slice(0, 1024)}`}
  }
  const base64 = (response.body as {base64?: unknown} | null)?.base64
  const body = response.body ?? ''
  const encoded =
    typeof base64 === 'string' ? base64 : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64')
  if (Buffer.byteLength(encoded, 'base64') > maxResponseBytes) return {error: 'The custom renderer exceeds the bridge limit'}
  return {type: response.contentType, base64: encoded}
}
