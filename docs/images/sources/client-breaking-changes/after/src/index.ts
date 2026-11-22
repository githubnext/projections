/** A response from the API. */
export interface Response {
  status: number
  headers: Record<string, string>
  body: unknown
}

/** How a client reaches the API. */
export interface ClientOptions {
  baseUrl: string
  timeoutMs?: number
  retries?: number
}

/** A client for one API. */
export interface Client {
  get: (path: string) => Promise<Response>
  post: (path: string, body: unknown) => Promise<Response>
}

/** Creates a client for the API that `options` describes. */
export declare function createClient(options: ClientOptions): Client
