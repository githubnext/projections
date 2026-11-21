import {acceptsExtraction, describeAccepts, parseRendererManifest} from '@githubnext/projections-renderer-sdk/protocol'
import type {RendererAccepts, RendererManifest} from '@githubnext/projections-renderer-sdk/protocol'
import type {ExtractionDocument, RendererBundle} from '@githubnext/projections-schemas'
import type {ComparisonMode} from './modes.js'

/** A renderer bundle the host can load. */
export interface RendererEntry {
  name: string
  title: string
  handles: string[]
  /** URL of the bundle's `index.html`. */
  url: string
  /** Built-in renderers ship with Projections; custom renderers come from a projection definition. */
  source: 'builtin' | 'custom'
  /** The comparison modes the manifest declares; the renderer's `ready` capabilities confirm them. Omitted: the defaults. */
  comparisonModes?: ComparisonMode[]
  /** The extractions the bundle presents (`RendererManifest.accepts`); omitted, any. */
  accepts?: RendererAccepts[]
  /**
   * The bundle's document as this host runs it, for a renderer that nests it (`document-request`). Omitted, it is
   * fetched from `url`. A host that rewrites documents, as an editor webview adds its script nonce, supplies its own.
   */
  document?: () => Promise<string>
}

/**
 * Supplies a built-in renderer's document by name, for a renderer that runs it in a frame nested in its own
 * (`document-request`). Rejects with the reason for any other name.
 */
export type RendererDocuments = (name: string) => Promise<string>

/**
 * The built-in renderer documents of `catalog`, by name (a bundle's own, or one it handles, such as `dag` for the graph
 * bundle): only entries with `source: 'builtin'`, from the host's own registry. A renderer names what it wants and never supplies a URL or path; an unknown name or a custom renderer is
 * refused with the reason, which the host passes on. Each document is read once, with its entry's `document` or
 * fetched from its `url`.
 */
export function builtinRendererDocuments(catalog: readonly RendererEntry[], fetcher: typeof fetch = globalThis.fetch): RendererDocuments {
  const documents = new Map<string, Promise<string>>()
  return name => {
    const builtin = catalog.filter(candidate => candidate.source === 'builtin')
    // A definition may name a bundle by a name it handles (`dag` for the graph bundle), as renderer resolution does.
    const entry = builtin.find(candidate => candidate.name === name) ?? builtin.find(candidate => candidate.handles.includes(name))
    if (!entry) {
      const custom = catalog.some(candidate => candidate.name === name)
      return Promise.reject(
        new Error(custom ? `${name} is a custom renderer; hosts supply only built-in renderers` : `${name} is not a built-in renderer`),
      )
    }
    let document = documents.get(entry.name)
    if (!document) {
      document = entry.document ? entry.document() : text(new URL(entry.url, pageHref()), fetcher)
      documents.set(entry.name, document)
      // A failed read is tried again on the next request.
      document.catch(() => documents.delete(entry.name))
    }
    return document
  }
}

async function text(url: URL, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, {credentials: 'omit', redirect: 'error', cache: 'no-store'})
  if (!response.ok) throw new Error(`Renderer request failed (${response.status}): ${url.pathname}`)
  return response.text()
}

/** The extraction a renderer is chosen for: its schema, and the vocabularies it declares. */
export interface RendererSubject {
  schema: string
  vocabularies?: readonly string[] | undefined
}

/** Whether `entry` presents `subject`. With a schema name alone, vocabularies aren't checked. */
export function rendererAccepts(entry: RendererEntry, subject: string | RendererSubject | undefined): boolean {
  if (subject === undefined || !entry.accepts) return true
  if (typeof subject === 'string') return entry.accepts.some(item => item.schema === subject)
  return acceptsExtraction(entry.accepts, subject)
}

/** A catalog of built-in renderer bundles, `renderers/index.json`, written by `collectRenderers`. */
export interface RendererCatalogDocument {
  format: 'projections.renderers'
  version: 0
  renderers: RendererManifest[]
}

async function json(url: URL, fetcher: typeof fetch, signal?: AbortSignal): Promise<unknown> {
  const response = await fetcher(url, {credentials: 'omit', redirect: 'error', cache: 'no-store', ...(signal ? {signal} : {})})
  if (!response.ok) throw new Error(`Renderer request failed (${response.status}): ${url.pathname}`)
  return response.json()
}

function entry(manifest: RendererManifest, base: URL, source: RendererEntry['source']): RendererEntry {
  return {
    name: manifest.name,
    title: manifest.title,
    handles: manifest.handles,
    url: new URL(`${manifest.name}/index.html`, base).href,
    source,
    ...(manifest.comparisonModes ? {comparisonModes: manifest.comparisonModes} : {}),
    ...(manifest.accepts ? {accepts: manifest.accepts} : {}),
  }
}

/**
 * Loads built-in renderer manifests. With `names`, reads each
 * `<base><name>/renderer.json` (the Inspector server lists names at
 * `GET /api/renderers`); otherwise reads `<base>index.json`.
 */
export async function loadRendererCatalog({
  base,
  names,
  fetch: fetcher = globalThis.fetch,
  signal,
}: {
  base: string | URL
  names?: readonly string[]
  fetch?: typeof fetch
  signal?: AbortSignal
}): Promise<RendererEntry[]> {
  const root = new URL(base, pageHref())
  if (!root.pathname.endsWith('/')) root.pathname += '/'
  if (names) {
    const manifests = await Promise.all(
      names
        .filter(name => /^[a-z0-9][a-z0-9-]{0,63}$/.test(name))
        .map(async name => parseRendererManifest(await json(new URL(`${name}/renderer.json`, root), fetcher, signal))),
    )
    return manifests.map(manifest => entry(manifest, root, 'builtin'))
  }
  const catalog = (await json(new URL('index.json', root), fetcher, signal)) as Partial<RendererCatalogDocument>
  if (catalog.format !== 'projections.renderers' || catalog.version !== 0 || !Array.isArray(catalog.renderers)) {
    throw new Error('Unsupported renderer catalog')
  }
  return catalog.renderers.map(manifest => entry(parseRendererManifest(manifest), root, 'builtin'))
}

/** Describes a custom renderer bundle served at `url` (its `index.html`). */
export function customRenderer(manifest: RendererManifest, url: string | URL): RendererEntry {
  return {
    name: manifest.name,
    title: manifest.title,
    handles: manifest.handles,
    url: new URL(url, pageHref()).href,
    source: 'custom',
    ...(manifest.comparisonModes ? {comparisonModes: manifest.comparisonModes} : {}),
    ...(manifest.accepts ? {accepts: manifest.accepts} : {}),
  }
}

/** What `resolveRenderer` chose: the bundle to use, if any (else the host's table and text views), and why. */
export interface RendererResolution {
  renderer?: RendererEntry
  /** Why no renderer, or a different one than requested, is shown. Always displayed by the host. */
  notice?: string
}

/** Why an embedding application withholds a custom renderer, for example because it needs trust that wasn't granted. */
export interface WithheldRenderer {
  withheld: string
}

/**
 * The built-in bundle for an extraction: one named for its schema's family (`graph` for `graph/v0`), or one
 * that handles it, among those that accept it; otherwise any bundle that declares it accepts it.
 */
function schemaRenderer(subject: string | RendererSubject | undefined, catalog: readonly RendererEntry[]): RendererEntry | undefined {
  const schema = typeof subject === 'string' ? subject : subject?.schema
  const family = schema?.split('/')[0]
  if (!family) return undefined
  const fitting = catalog.filter(item => rendererAccepts(item, subject))
  return (
    fitting.find(item => item.name === family) ??
    fitting.find(item => item.handles.includes(family)) ??
    fitting.find(item => item.accepts?.some(accepted => accepted.schema === schema))
  )
}

function describeSubject(subject: string | RendererSubject): string {
  if (typeof subject === 'string') return `\`${subject}\``
  const vocabularies =
    subject.vocabularies?.length !== undefined && subject.vocabularies.length > 0
      ? ` with ${subject.vocabularies.map(name => `\`${name}\``).join(', ')}`
      : ''
  return `\`${subject.schema}\`${vocabularies}`
}

/**
 * Chooses the bundle for a definition's renderer. A built-in name matches a
 * bundle with that name first, then the first bundle that handles it. A custom
 * bundle must be supplied by the embedding application; when it isn't, the
 * built-in renderer for the extraction's `schema` is used. A bundle that
 * declares what it accepts (`RendererEntry.accepts`) is used only for those
 * extractions; for another, the notice names what it presents and the
 * built-in renderer for the extraction is used instead. When nothing
 * matches, the host's own table and text views are used. The notice says why.
 * Pass the extraction (its `schema` and `vocabularies`) so vocabularies are checked too.
 */
export function resolveRenderer(
  requested: string | RendererBundle,
  catalog: readonly RendererEntry[],
  custom?: RendererEntry | WithheldRenderer,
  extraction?: string | RendererSubject,
): RendererResolution {
  const instead = (reason: string): RendererResolution => {
    const fallback = schemaRenderer(extraction, catalog)
    return fallback
      ? {renderer: fallback, notice: `${reason} Showing the built-in ${fallback.title} renderer instead.`}
      : {notice: `${reason} Showing the built-in table view.`}
  }
  const checked = (renderer: RendererEntry): RendererResolution =>
    extraction === undefined || rendererAccepts(renderer, extraction)
      ? {renderer}
      : instead(
          `The ${renderer.title} renderer presents ${describeAccepts(renderer.accepts!)}; this extraction is ${describeSubject(extraction)}.`,
        )
  if (typeof requested !== 'string') {
    if (custom && !('withheld' in custom)) return checked(custom)
    return instead(custom?.withheld ?? `The custom renderer ${requested.bundle} is not available here.`)
  }
  const renderer = catalog.find(item => item.name === requested) ?? catalog.find(item => item.handles.includes(requested))
  if (renderer) return checked(renderer)
  return {notice: `The renderer "${requested}" is not available here. Showing the built-in table view.`}
}

/**
 * Bundles that can present a projection: the resolved renderer first, then
 * any other bundle named for or handling the definition's renderer or the
 * extraction's schema family, then any that declares it accepts the
 * extraction. Bundles that declare they don't accept it are left out.
 */
export function compatibleRenderers(
  document: ExtractionDocument,
  catalog: readonly RendererEntry[],
  resolved?: RendererEntry,
): RendererEntry[] {
  const requested = document.projection.renderer
  const extraction = document.extraction
  const names = new Set([typeof requested === 'string' ? requested : '', extraction.schema.split('/')[0] ?? ''].filter(Boolean))
  const named = (entry: RendererEntry) => names.has(entry.name) || entry.handles.some(name => names.has(name))
  const declared = (entry: RendererEntry) => entry.accepts !== undefined
  const list = resolved ? [resolved] : []
  for (const fits of [named, declared]) {
    for (const entry of catalog) {
      if (fits(entry) && rendererAccepts(entry, extraction) && !list.some(item => item.url === entry.url)) list.push(entry)
    }
  }
  return list
}

/** The page's address, which there is none of outside a browser. */
function pageHref(): string | undefined {
  const location = globalThis.location as Location | undefined
  return location?.href
}
