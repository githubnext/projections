/** A response from the API. */
export interface Response {
  status: number
  body: unknown
}

/** A client for one API. */
export interface Client {
  get(path: string): Promise<Response>
  post(path: string, body: unknown): Promise<Response>
  /** @deprecated Use `get` with a query string. */
  search(query: string): Promise<Response>
}

/** Creates a client for the API at `baseUrl`. */
export declare function createClient(baseUrl: string, timeoutMs?: number): Client

/** Retries a request until it succeeds or `attempts` run out. */
export declare function withRetry(client: Client, attempts: number): Client
