import path from 'node:path'
import {glob, record} from '../shared.js'
import {code, inputs, native, slash, type Package, type Project} from './model.js'

function owner(project: Project, file: string): Package {
  const relative = slash(path.relative(project.root, file))
  return project.packages.find(pkg => !pkg.directory || relative.startsWith(`${pkg.directory}/`))!
}

export type Entry = {pkg: Package; subpath: string; file: string}
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
  if (exports !== undefined)
    return exports && typeof exports === 'object' && !Array.isArray(exports) && Object.keys(exports).some(key => key.startsWith('.'))
      ? Object.entries(exports)
      : [['.', exports]]
  if (manifest.types !== undefined || manifest.typings !== undefined) return [['.', manifest.types ?? manifest.typings]]
  return []
}

/** Every program source a wildcard export target matches, as its own subpath. */
function addWildcard(project: Project, add: Add, pkg: Package, subpath: string, target: string, relative: string): void {
  const pattern = glob(slash(path.resolve(project.root, relative)))
  const matches = project.sources.filter(item => pattern.test(slash(item.source.fileName)))
  if (!matches.length) throw new Error(`Package export wildcard ${code(target)} matched no program sources; set \`inputs.entrypoints\``)
  for (const {source} of matches) {
    const prefix = path.resolve(project.root, relative).split('*')[0]!
    const suffix = target.split('*')[1] ?? ''
    const replacement = native(source.fileName).slice(prefix.length, suffix ? -suffix.length : undefined)
    add(pkg, subpath.replace('*', slash(replacement)), slash(path.relative(project.root, source.fileName)))
  }
}

function addPackage(project: Project, add: Add, pkg: Package): void {
  const exports = pkg.manifest.exports
  for (const [subpath, value] of mappings(pkg.manifest)) {
    if (value === null) continue
    const paths = [...new Set(targets(value))].sort()
    if (!paths.length) throw new Error(`Unsupported package exports for ${code(pkg.name)} ${code(subpath)}; set \`inputs.entrypoints\``)
    for (const target of paths) {
      if (!target.startsWith('./') && exports !== undefined)
        throw new Error(`Package export ${code(pkg.name)} ${code(subpath)} must be repository-local; set \`inputs.entrypoints\``)
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
    if (!file)
      throw new Error(
        `Public API entrypoint ${code(relative)} for ${code(pkg.name)} (${code(subpath)}) is missing or outside the selected tsconfig program. Set \`inputs.entrypoints\` to source entrypoints or include its declarations.`,
      )
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
  if (!entries.length)
    throw new Error(
      'Cannot identify the public API. Define `package.json` `exports` or `types`, or `inputs.entrypoints` (an array of paths or a subpath-to-path object).',
    )
  return entries
}
