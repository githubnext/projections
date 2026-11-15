/**
 * The content security policy for every file of a renderer bundle: inline scripts and styles, Wasm, `data:` and
 * `blob:` media, no network and a scripts-only sandbox. Matches `rendererContentSecurityPolicy` in the renderer SDK.
 */
export declare const rendererContentSecurityPolicy: string
/**
 * The response headers for a file served from a renderer bundle directory: its content type by extension
 * (`application/octet-stream` for an unknown one), `rendererContentSecurityPolicy`, `nosniff`, no referrer, a
 * cross-origin resource policy and `no-store`.
 *
 * @param path - The file's path or name; only its extension is read, case-insensitively.
 */
export declare function rendererResponseHeaders(path: string): Record<string, string>
/** A collected bundle's `renderer.json`, as `collectRenderers` validated it and lists it in `renderers/index.json`. */
export interface CollectedRenderer {
  format: 'projections.renderer'
  version: 0
  /** The bundle's directory under `renderers/`: lowercase letters, digits and hyphens, at most 64 characters. */
  name: string
  title: string
  /** The definition renderer names the bundle presents, for example `["graph", "dag"]`. */
  handles: string[]
}
/**
 * Copies built renderer bundles into `<outDir>/renderers/<name>/`, replacing that directory, and writes
 * `renderers/index.json` (the catalog) and `renderers/THIRD_PARTY_NOTICES.txt` (every bundle's notices, merged). Each
 * package declares its bundle directory in its package.json as `"projections": {"renderer": "dist"}`, holding
 * `index.html`, `renderer.json` and `THIRD_PARTY_NOTICES.txt`.
 *
 * @param options - `packages` to collect, in catalog order; `outDir`, the build output; `from`, the importing module's
 *   URL, from which the packages are resolved.
 * @returns The collected bundles' `renderer.json`, in `packages` order.
 * @throws If a package declares no bundle directory, its bundle isn't built or lacks a file, its `renderer.json` is
 *   invalid, or two bundles share a name.
 *
 * @example
 * ```ts
 * await collectRenderers({packages: ['@githubnext/projections-renderer-graph'], outDir: 'dist', from: import.meta.url})
 * ```
 */
export declare function collectRenderers(options: {
  packages: string[]
  outDir: string | URL
  from: string | URL
}): Promise<CollectedRenderer[]>
/**
 * The third-party notices of the renderer bundles in `packages`, merged so each package version appears once.
 *
 * @param options - `packages` and `from` as for `collectRenderers`; `exclude`, package names the including app's own
 *   notices already list, such as `browserNoticePackages`.
 * @throws If a package's bundle has no THIRD_PARTY_NOTICES.txt.
 */
export declare function rendererNotices(options: {packages: string[]; from: string | URL; exclude?: Iterable<string>}): Promise<string>
