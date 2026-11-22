import path from 'node:path'
import type ts from 'typescript'
import {record} from '../shared.js'
import {compareIds} from '../values.js'
import {code, slash, type Package} from './model.js'
import type {SourceFiles} from './files.js'

const deepestFirst = (a: Package, b: Package): number => b.directory.length - a.directory.length || compareIds(a.name, b.name)

/** Every loaded repository package manifest, deepest first. */
function manifests(files: SourceFiles): Package[] {
  const {root, texts, aliases} = files
  const candidates: Package[] = []
  for (const [file, text] of texts) {
    if (path.basename(file) !== 'package.json' || aliases.has(file) || file.includes(`${path.sep}node_modules${path.sep}`)) continue
    let manifest: Record<string, unknown>
    try {
      manifest = record(JSON.parse(text), slash(path.relative(root, file)))
    } catch (error) {
      throw new Error(`Invalid package manifest ${code(slash(path.relative(root, file)))}: ${String(error)}`, {cause: error})
    }
    const directory = slash(path.relative(root, path.dirname(file)))
    const name = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name : directory || '(root)'
    candidates.push({name, directory, manifest})
  }
  return candidates.toSorted(deepestFirst)
}

/**
 * The API packages are those owning the selected program's root files (the
 * tsconfig's files or the entry points), not every manifest in the tree: a
 * monorepo's unrelated packages and fixtures neither contribute exports nor
 * need unique names.
 */
export function apiPackages(files: SourceFiles, programs: ts.Program[], entryFiles: string[]): Package[] {
  const candidates = manifests(files)
  const rootFiles = new Set([
    ...programs.flatMap(program => program.getRootFileNames().map(file => path.resolve(file))),
    ...entryFiles.map(file => path.resolve(files.root, file)),
  ])
  const packages: Package[] = []
  for (const file of [...rootFiles].toSorted()) {
    const relative = slash(path.relative(files.root, file))
    const pkg = candidates.find(item => !item.directory || relative.startsWith(`${item.directory}/`))
    if (pkg && !packages.includes(pkg)) {
      if (packages.some(other => other.name === pkg.name)) {
        throw new Error(`Duplicate package name ${code(pkg.name)}; package identities must be unique`)
      }
      packages.push(pkg)
    }
  }
  if (!packages.some(pkg => !pkg.directory)) packages.push({name: '(root)', directory: '', manifest: {}})
  return packages.toSorted(deepestFirst)
}
