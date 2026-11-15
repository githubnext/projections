import {lstat, readFile, realpath} from 'node:fs/promises'
import path from 'node:path'
import {parseJson} from './json/parse.js'
import type {ExtractorRequest, Entity, Relationship, Extraction, Json, DomainSchema} from './types.js'
import type {Toolchain} from './toolchain.js'
import type {WorkerExtractorId} from './ids.js'

export interface ExtractorContext {
  /** The extractor this helper runs, from its invocation: the definition may name it through a command. */
  extractor: WorkerExtractorId
  input: ExtractorRequest
  files: string[]
  /** Where the repository's own installed packages (its compiler) are resolved. */
  toolchain: Toolchain
}

export function stringInput(context: ExtractorContext, key: string, fallback?: string): string {
  const value = context.input.projection.definition.inputs?.[key] ?? fallback
  if (typeof value !== 'string' || !value.trim()) throw new Error(`inputs.${key} must be a nonempty string`)
  return value
}

/** The directory holding the examined revision; the helper always runs on one. */
export function repositoryRoot(context: ExtractorContext): string {
  const root = context.input.repository.root
  if (typeof root !== 'string') throw new Error('The TypeScript helper needs the revision on disk (repository.root)')
  return root
}

export async function sourcePath(context: ExtractorContext, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..'))
    throw new Error(`Path must stay within the repository: ${relative}`)
  const root = await realpath(repositoryRoot(context))
  const target = path.resolve(root, relative)
  let cursor = root
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Extractor input may not traverse symlinks: ${relative}`)
  }
  return target
}

/**
 * The real path of a repository-relative input, following symlinks only while
 * they stay inside the repository: a workspace link such as
 * `node_modules/@scope/package` → `packages/package` resolves to its target, and
 * a link whose target leaves the root is rejected. Missing segments throw `ENOENT`.
 */
export async function containedPath(context: ExtractorContext, relative: string): Promise<string> {
  return containedIn(await realpath(repositoryRoot(context)), relative)
}

/**
 * `containedPath` under another real directory, such as the repository checkout
 * whose installed packages the compiler reads: symlinks are followed only while
 * they stay inside `root`.
 */
export async function containedIn(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..'))
    throw new Error(`Path must stay within the repository: ${relative}`)
  const inside = (file: string) => {
    const offset = path.relative(root, file)
    return offset === '' || (offset !== '..' && !offset.startsWith(`..${path.sep}`) && !path.isAbsolute(offset))
  }
  let cursor = root
  for (const segment of relative.split(/[\\/]/).filter(segment => segment && segment !== '.')) {
    cursor = path.join(cursor, segment)
    if ((await lstat(cursor)).isSymbolicLink()) {
      cursor = await realpath(cursor)
      if (!inside(cursor)) throw new Error(`Extractor input may not traverse symlinks that leave the repository: ${relative}`)
    }
  }
  return cursor
}

export async function readSource(context: ExtractorContext, relative: string): Promise<string> {
  const file = await sourcePath(context, relative)
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error(`Input must be a regular file under 32 MiB: ${relative}`)
  return readFile(file, 'utf8')
}

export async function readJson(context: ExtractorContext, relative: string): Promise<unknown> {
  try {
    return parseJson(await readSource(context, relative))
  } catch (error) {
    throw new Error(`Cannot read JSON input ${relative}: ${error instanceof Error ? error.message : String(error)}`, {cause: error})
  }
}

export function extraction(
  schema: DomainSchema,
  entities: Entity[],
  relationships: Relationship[] = [],
  metadata?: Record<string, Json>,
): Extraction {
  return {protocolVersion: 0, schema, entities, relationships, ...(metadata ? {metadata} : {})}
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

/** Compiles a `*`, `**` and `?` path glob against repository-relative posix paths. */
export function glob(pattern: string): RegExp {
  let source = ''
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!
    if (character === '*' && pattern[index + 1] === '*') {
      index++
      if (pattern[index + 1] === '/') {
        index++
        source += '(?:.*/)?'
      } else source += '.*'
    } else if (character === '*') source += '[^/]*'
    else if (character === '?') source += '[^/]'
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}
