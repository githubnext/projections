/** The built Storybook (`storybook-static/`, with a trailing slash): `startStorybookServer`'s default root. */
export declare const storybookDirectory: string
/**
 * The page content security policy a production host would send: everything from this origin only, Wasm allowed, and
 * no inline scripts except those given, which are allowed by their SHA-256 hashes.
 *
 * @param inlineScripts - The bodies of the page's inline `<script>` elements.
 */
export declare function hostContentSecurityPolicy(inlineScripts?: string[]): string
/**
 * Serves a built Storybook on `127.0.0.1` as a production host would: pages under `hostContentSecurityPolicy`,
 * renderer bundles (`renderers/`, `test-renderers/`) with the renderer policy (`rendererResponseHeaders`), and a probe
 * log of requests a sandboxed renderer must never make (any request to `/__probe/…`, read back from `/__probe-log`).
 * Anything but a `GET` of a file under `root` is a 404.
 *
 * @param options - `root`, the built Storybook (default `storybookDirectory`); `port`, 0 (default) for any free one.
 * @returns The server's `url` (with a trailing slash), and `close`, which drops open connections and stops it.
 *
 * @example
 * ```ts
 * const {url, close} = await startStorybookServer()
 * await page.goto(`${url}iframe.html?id=${storyId}&viewMode=story`)
 * await close()
 * ```
 */
export declare function startStorybookServer(options?: {root?: string; port?: number}): Promise<{url: string; close: () => Promise<void>}>
