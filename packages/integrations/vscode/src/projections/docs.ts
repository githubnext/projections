/**
 * Where documentation links go: the repository's Markdown on GitHub, followed by a file's path. The CLI's `DOCS_BASE`
 * (packages/cli/src/docs.rs) is the same; repoint both when the repository moves. Open Documentation on GitHub uses it.
 */
export const DOCS_BASE = 'https://github.com/githubnext/projections/blob/main/'

/** The bundled documentation's index (dist/docs/index.json, which scripts/docs.mjs writes): pages by their bundled name. */
export interface DocsIndex {
  /** Each built-in extractor's page, by its id. */
  extractors: Record<string, string>
  /** Each built-in renderer's page, by each of its handles. */
  renderers: Record<string, string>
  /** The default comparator's page. */
  comparator: string
  /** Each page's file in the repository (`extractors/repository-map.md` → `docs/builtins/extractors/repository-map.md`), for its link on GitHub. */
  sources: Record<string, string>
}

/**
 * The bundled page of a built-in part: an extractor's page by its id, a renderer's by any of its handles, the default
 * comparator's. Undefined for anything else (a file, a command, an id the bundle doesn't know).
 */
export function partDocs(index: DocsIndex | undefined, part: 'extractor' | 'comparator' | 'renderer', label: string): string | undefined {
  if (!index) return undefined
  const own = (pages: Record<string, string>) => (Object.hasOwn(pages, label) ? pages[label] : undefined)
  if (part === 'extractor') return own(index.extractors)
  if (part === 'renderer') return own(index.renderers)
  return label === 'default' ? index.comparator : undefined
}

/** A bundled page's name (`extractors/x.md`, leading slashes ignored), or undefined when it can't be one (`..`, empty). */
export function docsPage(path: string): string | undefined {
  const segments = path.replace(/^\/+/u, '').split('/')
  if (!segments.length || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
    return undefined
  }
  return segments.join('/')
}

/** A bundled page on GitHub (Open Documentation on GitHub), or undefined when the bundle doesn't know it. */
export function docsOnGitHub(index: DocsIndex | undefined, page: string): string | undefined {
  const source = index && Object.hasOwn(index.sources, page) ? index.sources[page] : undefined
  return source ? `${DOCS_BASE}${source}` : undefined
}
