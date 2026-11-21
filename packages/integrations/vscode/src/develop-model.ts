/*
 * What the Viewing view's Bookmarks and Recent changes read and write: a run over the recent commits (`/api/sweep`)
 * as it lists them, the bookmarks file, and the renderers' scenarios the Definition view lists. Nothing here imports
 * VS Code (or anything at run time).
 */

/** A sweep cell, as `GET /api/sweep` lists it. */
export interface DevelopCell {
  projection: string
  before: string
  after: string
  status: 'changed' | 'unchanged' | 'failed'
  changes?: number
  counts?: Record<string, number>
  error?: string
}

/** A swept change, as `GET /api/sweep` lists it. */
export interface DevelopChange {
  before: string
  after: string
  title: string
  kind: string
  date?: string
}

/**
 * JSON text for a workspace file: indented like `existing` (the file's current text), else by two spaces (as when it
 * is new or minified), with a final newline.
 */
export function jsonText(value: unknown, existing?: string): string {
  const indent = existing ? /\n([ \t]+)\S/.exec(existing)?.[1] : undefined
  return `${JSON.stringify(value, null, indent ?? 2)}\n`
}

const short = (ref: string) => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 8) : ref)
/**
 * The bookmarks file with a bookmark of a pair added (`.projections-bookmarks.json`, as `projections` reads it): an
 * ID from the projection and the pair, unique in the file; the file's other bookmarks kept, sorted by ID, and its
 * indentation kept.
 */
export function addBookmark(
  text: string | undefined,
  bookmark: {projectionId: string; before: string; after: string; title: string},
): {text: string; id: string} {
  const file = text?.trim()
    ? (JSON.parse(text) as {format?: unknown; version?: unknown; bookmarks?: unknown})
    : {format: 'projections.bookmarks', version: 0, bookmarks: []}
  if (file.format !== 'projections.bookmarks' || file.version !== 0 || !Array.isArray(file.bookmarks)) {
    throw new Error('.projections-bookmarks.json is not a bookmarks file this version reads')
  }
  const bookmarks = file.bookmarks as {id?: unknown}[]
  const ids = new Set(bookmarks.map(item => String(item.id)))
  const base = `${bookmark.projectionId}-${short(bookmark.after)}`.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 90)
  let id = base
  for (let index = 2; ids.has(id); index++) id = `${base}-${index}`
  const next = [
    ...bookmarks,
    {id, title: bookmark.title.slice(0, 1000) || id, projectionId: bookmark.projectionId, before: bookmark.before, after: bookmark.after},
  ].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return {text: jsonText({format: 'projections.bookmarks', version: 0, bookmarks: next}, text), id}
}

/** `.projections-bookmarks.json` without the bookmark `id` (the Viewing view's Remove). */
export function removeBookmark(text: string, id: string): string {
  const file = JSON.parse(text) as {format?: unknown; version?: unknown; bookmarks?: unknown}
  if (file.format !== 'projections.bookmarks' || file.version !== 0 || !Array.isArray(file.bookmarks)) {
    throw new Error('.projections-bookmarks.json is not a bookmarks file this version reads')
  }
  const bookmarks = (file.bookmarks as {id?: unknown}[]).filter(item => String(item.id) !== id)
  return jsonText({...file, bookmarks}, text)
}

/**
 * Checking recent commits' progress, in the UI's words (never "sweep"): cells reached of the cells it will have (one
 * per change and projection; `projections` is how many it checks).
 */
export function sweepProgress(
  sweep: {status: string; changes: readonly unknown[]; cells: readonly unknown[]} | undefined,
  projections = 1,
): string {
  if (!sweep) return ''
  if (sweep.status === 'running') {
    return `Checking recent commits… ${sweep.cells.length} of ${sweep.changes.length * Math.max(1, projections) || '…'}`
  }
  if (sweep.status === 'cancelled') return 'Checking recent commits cancelled'
  if (sweep.status === 'failed') return 'Checking recent commits failed'
  return ''
}

/** A `projections.scenarios` document's title, renderer and scenarios, or undefined when the text isn't one. */
export function parseScenarios(text: string): {title?: string; renderer?: string; scenarios: {id: string; title: string}[]} | undefined {
  let document: {format?: unknown; title?: unknown; renderer?: unknown; scenarios?: unknown}
  try {
    document = JSON.parse(text) as typeof document
  } catch {
    return undefined
  }
  if (document?.format !== 'projections.scenarios' || !Array.isArray(document.scenarios)) return undefined
  const scenarios = (document.scenarios as {id?: unknown; title?: unknown}[]).flatMap(item =>
    typeof item?.id === 'string' ? [{id: item.id, title: typeof item.title === 'string' ? item.title : item.id}] : [],
  )
  return {
    ...(typeof document.title === 'string' ? {title: document.title} : {}),
    ...(typeof document.renderer === 'string' ? {renderer: document.renderer} : {}),
    scenarios,
  }
}

/**
 * Whether a scenarios file is for a projection's renderer: a built-in by name (its `renderer`), or a custom bundle
 * by the package holding it (the scenarios file's directory contains the bundle). Paths are workspace-relative.
 */
export function scenariosFor(file: {directory: string; renderer?: string}, renderer: {label: string; bundle?: string}): boolean {
  if (renderer.bundle) {
    const bundle = renderer.bundle.replace(/^\.\//, '')
    const directory = file.directory.replace(/^\.\/?/, '').replace(/\/$/, '')
    return directory === '' || bundle.startsWith(`${directory}/`)
  }
  return file.renderer === renderer.label
}
