import type {Entity} from '@githubnext/projections-schemas'
import {fileCategory, plainCategory} from '@githubnext/projections-renderer-kit'
import type {Category} from '@githubnext/projections-renderer-kit'

/** What a file's circle is sized by: its bytes, or its lines when the extraction counts them. */
export type SizeMeasure = 'bytes' | 'lines'

const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined)

/**
 * A leaf's weight: `data.lines` when sizing by lines (0 for files without a
 * count, such as binaries), otherwise `data.size` (repository-map bytes) or a
 * weighted hierarchy's `data.value`.
 */
export function weightOf(entity: Entity | undefined, measure: SizeMeasure): number {
  const data = entity?.data
  if (!data) return 0
  if (measure === 'lines') return finite(data.lines) ?? 0
  return finite(data.size) ?? finite(data.value) ?? 0
}

/** Whether any entity counts lines, so the "Size by" control is offered. */
export function hasLineCounts(entities: Iterable<Entity | undefined>): boolean {
  for (const entity of entities) if (finite(entity?.data?.lines) !== undefined) return true
  return false
}

/** The repository path an entity declares (`data.path`), if any. */
export function pathOf(entity: Entity | undefined): string | undefined {
  const path = entity?.data?.path
  return typeof path === 'string' && path.length ? path : undefined
}

/**
 * How leaves are colored: by file type (their Linguist language, else their
 * extension; see the kit's `categoryPalette`) when the document has
 * repository paths, else by entity kind (a generic weighted hierarchy).
 */
export type CategoryMode = 'files' | 'kind'

export function categoryOf(entity: Entity, mode: CategoryMode): Category {
  return mode === 'files' ? fileCategory(pathOf(entity) ?? entity.label) : plainCategory(entity.kind)
}

/**
 * A leaf's flags: the attributes it has besides its kind (`data.flags`, strings), in their order, without repeats or
 * its own kind. Drawn as dots in the colors of the kinds of those names.
 */
export function flagsOf(entity: Entity | undefined): string[] {
  const flags = entity?.data?.flags
  if (!Array.isArray(flags)) return []
  const kind = entity!.kind
  return [...new Set(flags.filter((flag): flag is string => typeof flag === 'string' && flag.length > 0 && flag.length <= 256))].filter(
    flag => flag !== kind,
  )
}

/** The legend title: what colors, dots and sizes mean. */
export function legendTitle(mode: CategoryMode, measure: SizeMeasure, flags = false): string {
  const colors = mode === 'files' ? 'Languages and file types' : flags ? 'Kinds, with flags as dots' : 'Kinds'
  return `${colors}, sized by ${measure === 'lines' ? 'lines' : mode === 'files' ? 'bytes' : 'weight'}`
}

/**
 * Path segments that hold dependencies or build output, hidden when `hideDependencies` is on. It is off by default, so
 * nothing is hidden unless asked; the original Repo Visualization hid them by default.
 */
export const dependencyDirectories = new Set([
  'node_modules',
  'bower_components',
  'dist',
  'out',
  'build',
  'target',
  'coverage',
  '.next',
  '.netlify',
  '.yarn',
  '.git',
  '.vscode',
  '.venv',
  'venv',
  '__pycache__',
])

/** Lockfiles, hidden when `hideLockfiles` is on (it is off by default): generated, and usually the largest files in a repository. */
export const lockfiles = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'composer.lock',
  'go.sum',
  'packages.lock.json',
  'flake.lock',
  'mix.lock',
  'Podfile.lock',
])

export interface Exclusions {
  dependencies: boolean
  lockfiles: boolean
  /** Hidden top-level paths (their first segment). */
  hidden: ReadonlySet<string>
}

/** Whether a repository path is excluded by the renderer's controls. */
export function excluded(path: string, exclusions: Exclusions): boolean {
  const segments = path.split('/')
  if (exclusions.hidden.has(segments[0]!)) return true
  if (exclusions.dependencies && segments.some(segment => dependencyDirectories.has(segment))) return true
  return exclusions.lockfiles && lockfiles.has(segments.at(-1)!)
}

/** A size for people: bytes as B, KB, MB (1024-based, as GitHub shows them), or a line count. */
export function formatSize(value: number, measure: SizeMeasure, locale = 'en-US'): string {
  const rounded = (amount: number, digits: number) => amount.toLocaleString(locale, {maximumFractionDigits: digits})
  if (measure === 'lines') return `${rounded(Math.round(value), 0)} ${Math.round(value) === 1 ? 'line' : 'lines'}`
  if (value < 1024) return `${rounded(Math.round(value), 0)} B`
  if (value < 1024 * 1024) return `${rounded(value / 1024, 1)} KB`
  return `${rounded(value / 1024 / 1024, 1)} MB`
}

/** A signed size difference, for example `+1.2 KB` or `−340 B`. */
export function formatDelta(delta: number, measure: SizeMeasure, locale = 'en-US'): string {
  if (Math.abs(delta) < 0.5) return 'no size change'
  return `${delta > 0 ? '+' : '−'}${formatSize(Math.abs(delta), measure, locale)}`
}
