/**
 * How the Inspector reaches its local runner. Every backend call goes through an `InspectorTransport`, so the same UI
 * runs inside an editor webview (messages to the extension, which relays them to `projections serve --stdio`), in a
 * headless page whose requests its host answers, or in another host.
 */

/** One request to the runner's `/api/` surface. */
export interface InspectorTransportRequest {
  method: 'GET' | 'POST'
  /** A server-relative path under `/api/`, with its query, for example `/api/definitions?ref=working-tree`. */
  path: string
  /** A JSON body; only `POST` has one. */
  body?: unknown
  signal?: AbortSignal
  /** `blob` for a binary response (a sweep thumbnail), resolved as a `Blob` with the response's content type. */
  responseType?: 'json' | 'blob'
}

/** A change channel the runner long-polls: the working tree (`/api/changes`) or the fixtures (`/api/fixtures/changes`). */
export type InspectorChangeChannel = 'changes' | 'fixtures'

/**
 * How the Inspector reaches its runner: over HTTP from a page the runner serves, or through messages an editor webview
 * relays to it (`createMessageTransport`).
 */
export interface InspectorTransport {
  /**
   * The origin server-relative URLs the runner returns (a custom renderer base, fixture renderer bundles) resolve
   * against: the page's own for a same-origin host, a sentinel the host relays for an editor webview.
   */
  readonly origin: string
  /** Sends one request. Resolves with the parsed JSON body; rejects with `InspectorRequestError` when the runner refuses. */
  request: (request: InspectorTransportRequest) => Promise<unknown>
  /**
   * The change subscription: resolves with the channel's next notification after generation `since` (or the
   * runner's unchanged notification after its wait), as `GET /api/changes?since=` returns it. Without it the client
   * long-polls through `request`, which is what the HTTP transport does.
   */
  next?: (channel: InspectorChangeChannel, since: number, signal?: AbortSignal) => Promise<unknown>
}

/** A request the runner refused or failed, with the HTTP `status` it answered with. */
export class InspectorRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'InspectorRequestError'
  }
}
