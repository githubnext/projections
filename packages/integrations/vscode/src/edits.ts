/*
 * Whether a projection has uncommitted edits: its definition file, or a file its definition declares (an extractor
 * script, a comparator file, a renderer bundle, their `sources`), differs from `HEAD`. Its tabs then apply the working
 * tree's definition and say "Your edits", with Show committed, which holds a tab on the committed definition until the
 * edits change again (their `editKey`). A definition that isn't committed at all has no committed version: it is `new`,
 * and tabs use it as it is. Nothing here imports VS Code (or anything at run time but `project-paths.ts`).
 */
import type {ProjectionDefinition} from './projections/definitions.js'
import {inRepository} from './project-paths.ts'

export type EditState = 'edited' | 'new' | undefined

/** One `git status --porcelain=v1` entry: its two-letter code and repository-relative path. */
export interface StatusEntry {
  code: string
  path: string
}

/**
 * The repository files a definition declares: its extractor script, comparator file, renderer bundle and `sources`,
 * repository-relative for a project at `prefix` (see `inRepository`).
 */
export function declaredFiles(definition: ProjectionDefinition, prefix = ''): string[] {
  const files: unknown[] = []
  const extractor = definition.extractor as unknown
  if (typeof extractor === 'object' && extractor !== null) {
    const command = (extractor as {command?: unknown}).command
    if (Array.isArray(command) && typeof command[1] === 'string' && !command[1].startsWith('-')) files.push(command[1])
    files.push(...(((extractor as {sources?: unknown}).sources as unknown[] | undefined) ?? []))
  }
  const comparator = definition.comparator as unknown
  if (typeof comparator === 'string') files.push(comparator)
  else if (typeof comparator === 'object' && comparator !== null) {
    files.push((comparator as {file?: unknown}).file)
    files.push(...(((comparator as {sources?: unknown}).sources as unknown[] | undefined) ?? []))
  }
  const renderer = definition.renderer as unknown
  if (typeof renderer === 'object' && renderer !== null) {
    files.push((renderer as {bundle?: unknown}).bundle)
    files.push(...(((renderer as {sources?: unknown}).sources as unknown[] | undefined) ?? []))
  }
  return [...new Set(files.map(path => inRepository(prefix, path)).filter((path): path is string => Boolean(path)))]
}

/**
 * The files that only present a projection's results: its custom renderer's package (the bundle's parent when the
 * bundle is a `dist`), bundle and `sources`, and its comparator file and `sources`, repository-relative for a project
 * at `prefix`. Editing them reloads the renderer or compares again; they change the definition's digest but not what
 * an extraction reads.
 */
export function presentationFiles(definition: ProjectionDefinition, prefix = ''): string[] {
  const files: (string | undefined)[] = []
  const add = (path: unknown) => files.push(inRepository(prefix, path))
  const comparator = definition.comparator as unknown
  if (typeof comparator === 'string') add(comparator)
  else if (typeof comparator === 'object' && comparator !== null) {
    add((comparator as {file?: unknown}).file)
    for (const source of ((comparator as {sources?: unknown}).sources as unknown[] | undefined) ?? []) add(source)
  }
  const renderer = definition.renderer as unknown
  if (typeof renderer === 'object' && renderer !== null) {
    const bundle = inRepository(prefix, (renderer as {bundle?: unknown}).bundle)
    files.push(bundle)
    if (bundle?.split('/').at(-1) === 'dist' && bundle.includes('/')) files.push(bundle.split('/').slice(0, -1).join('/'))
    for (const source of ((renderer as {sources?: unknown}).sources as unknown[] | undefined) ?? []) add(source)
  }
  return [...new Set(files.filter((path): path is string => Boolean(path)))]
}

/** Parses `git status --porcelain=v1 -z` output (a rename's original path is skipped). */
export function parseStatus(text: string): StatusEntry[] {
  const fields = text.split('\0')
  const entries: StatusEntry[] = []
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!
    if (field.length < 4) continue
    const code = field.slice(0, 2)
    entries.push({code, path: field.slice(3)})
    if (code.startsWith('R') || code.startsWith('C')) index++
  }
  return entries
}

/** The status entries a projection's edits are: its definition file's, and those of its declared files (or under them). */
export function touchedEntries(definitionPath: string, files: readonly string[], status: readonly StatusEntry[]): StatusEntry[] {
  const paths = [definitionPath, ...files]
  return status.filter(entry => paths.some(path => entry.path === path || entry.path.startsWith(`${path}/`)))
}

/**
 * A projection's edit state: `new` when its definition file isn't in `HEAD`, `edited` when it or a declared file (or
 * anything under a declared directory) has uncommitted changes, else nothing.
 */
export function editState(definitionPath: string, files: readonly string[], status: readonly StatusEntry[], committed: boolean): EditState {
  if (!committed) return 'new'
  return touchedEntries(definitionPath, files, status).length ? 'edited' : undefined
}

/**
 * What a projection's edits are, as one string: each touched file with its status and the hash of its content now
 * (`hashes`, from `git hash-object`; none for a deleted file). It changes whenever the edits do, which ends a tab's
 * Show committed.
 */
export function editKey(entries: readonly StatusEntry[], hashes: ReadonlyMap<string, string>): string | undefined {
  if (!entries.length) return undefined
  return entries
    .map(entry => `${entry.path}:${entry.code}:${hashes.get(entry.path) ?? ''}`)
    .sort()
    .join('\n')
}

/**
 * The definition revision a tab applies. Uncommitted edits apply (the working tree's definition) unless the tab shows
 * the committed version (Show committed, for these same edits). Without edits, Now, a new definition and a repository
 * without commits use the working tree's definition, which is then the committed one; other choices use `HEAD`'s.
 */
export function definitionRevisionFor({
  now,
  state,
  committed,
  hasCommits,
}: {
  now: boolean
  state: EditState
  /** The tab shows the committed definition for the current edits (Show committed). */
  committed: boolean
  hasCommits: boolean
}): 'working-tree' | 'HEAD' {
  if (!hasCommits || state === 'new') return 'working-tree'
  if (state === 'edited') return committed ? 'HEAD' : 'working-tree'
  return now ? 'working-tree' : 'HEAD'
}
