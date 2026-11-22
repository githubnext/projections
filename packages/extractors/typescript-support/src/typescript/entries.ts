import path from 'node:path'
import {glob, record} from '../shared.js'
import {code, inputs, native, slash, type Package, type Project} from './model.js'

function owner(project: Project, file: string): Package {
  const relative = slash(path.relative(project.root, file))
  return project.packages.find(pkg => !pkg.directory || relative.startsWith(`${pkg.directory}/`))!
}

export interface Entry {
  pkg: Package
  subpath: string
  file: string
}
type Add = (pkg: Package, subpath: string, relative: string) => void

/** The conditions' targets, preferring `types` where a condition object names it. */
function targets(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(targets)
  if (!value || typeof value !== 'object') return []
  const conditions = value as Record<string, unknown>
  if (conditions.types !== undefined) return targets(conditions.types)
  return Object.values(conditions).flatMap(targets)
}

/** A package's public subpaths and their targets, from `exports`, or `types`/`typings`. */
function mappings(manifest: Record<string, unknown>): [string, unknown][] {
  const exports = manifest.exports
  if (exports !== undefined) {
    return exports && typeof exports === 'object' && !Array.isArray(exports) && Object.keys(exports).some(key => key.startsWith('.'))
      ? Object.entries(exports)
      : [['.', exports]]
  }
  if (manifest.types !== undefined || manifest.typings !== undefined) return [['.', manifest.types ?? manifest.typings]]
  return []
}

/**
 * Every program source a wildcard export target matches, as its own subpath. As in Node's subpath patterns, the
 * subpath has one `*`, and every `*` in the target stands for the same text, which takes the subpath's `*`'s place.
 */
function addWildcard(project: Project, add: Add, pkg: Package, subpath: string, target: string, relative: string): void {
  const [head, tail, ...more] = subpath.split('*')
  if (tail === undefined || more.length) {
    throw new Error(
      `Package export ${code(pkg.name)} ${code(subpath)} maps to wildcard ${code(target)} without exactly one \`*\` of its own; set \`inputs.entrypoints\``,
    )
  }
  const resolved = path.resolve(project.root, relative)
  const pattern = glob(slash(resolved))
  const pieces = resolved.split('*')
  const fixed = pieces.join('').length
  let matched = false
  for (const {source} of project.sources.filter(item => pattern.test(slash(item.source.fileName)))) {
    const file = native(source.fileName)
    const replacement = file.slice(pieces[0]!.length, pieces[0]!.length + (file.length - fixed) / (pieces.length - 1))
    if (pieces.join(replacement) !== file) continue
    matched = true
    add(pkg, `${head}${slash(replacement)}${tail}`, slash(path.relative(project.root, source.fileName)))
  }
  if (!matched) throw new Error(`Package export wildcard ${code(target)} matched no program sources; set \`inputs.entrypoints\``)
}

function addPackage(project: Project, add: Add, pkg: Package): void {
  const exports = pkg.manifest.exports
  for (const [subpath, value] of mappings(pkg.manifest)) {
    if (value === null) continue
    const paths = [...new Set(targets(value))].toSorted()
    if (!paths.length) throw new Error(`Unsupported package exports for ${code(pkg.name)} ${code(subpath)}; set \`inputs.entrypoints\``)
    for (const target of paths) {
      if (!target.startsWith('./') && exports !== undefined) {
        throw new Error(`Package export ${code(pkg.name)} ${code(subpath)} must be repository-local; set \`inputs.entrypoints\``)
      }
      const relative = slash(path.join(pkg.directory, target))
      if (target.includes('*')) addWildcard(project, add, pkg, subpath, target, relative)
      else add(pkg, subpath, relative)
    }
  }
}

export function apiEntries(project: Project): Entry[] {
  const explicit = inputs(project.context).entrypoints
  const entries: Entry[] = []
  const add: Add = (pkg, subpath, relative) => {
    const absolute = path.resolve(project.root, relative)
    const alternatives = [
      absolute,
      absolute
        .replace(/\.mjs$/, '.mts')
        .replace(/\.cjs$/, '.cts')
        .replace(/\.jsx?$/, '.ts'),
      absolute
        .replace(/\.mjs$/, '.d.mts')
        .replace(/\.cjs$/, '.d.cts')
        .replace(/\.js$/, '.d.ts'),
    ]
    const file = alternatives.find(candidate => project.sources.some(item => native(item.source.fileName) === candidate))
    if (!file) {
      throw new Error(
        `Public API entrypoint ${code(relative)} for ${code(pkg.name)} (${code(subpath)}) is missing or outside the selected tsconfig program. Set \`inputs.entrypoints\` to source entrypoints or include its declarations.`,
      )
    }
    entries.push({pkg, subpath, file})
  }
  if (explicit !== undefined) {
    const mapping = Array.isArray(explicit)
      ? explicit.map(file => ['.', String(file)] as const)
      : (Object.entries(record(explicit, 'inputs.entrypoints')) as [string, string][])
    for (const [subpath, relative] of mapping) add(owner(project, path.resolve(project.root, relative)), subpath, relative)
    return entries
  }
  for (const pkg of project.packages) addPackage(project, add, pkg)
  if (!entries.length) {
    throw new Error(
      'Cannot identify the public API. Define `package.json` `exports` or `types`, or `inputs.entrypoints` (an array of paths or a subpath-to-path object).',
    )
  }
  return entries
}
