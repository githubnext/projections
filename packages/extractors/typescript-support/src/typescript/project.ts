import path from 'node:path'
import {containedPath, record, sourcePath, type ExtractorContext} from '../shared.js'
import {compareIds} from '../values.js'
import {inputs, native, sourceExtension, strings, type Project} from './model.js'
import {SourceFiles} from './files.js'
import {createHosts, readLibraries} from './hosts.js'
import {apiPackages} from './packages.js'
import {buildPrograms} from './programs.js'

/** The tsconfig files `inputs.tsconfig` or `inputs.tsconfigs` select, or the root `tsconfig.json` when present. */
function selectedConfigs(options: ReturnType<typeof inputs>, files: SourceFiles): string[] {
  if (options.tsconfig !== undefined && options.tsconfigs !== undefined) {
    throw new Error('Use `inputs.tsconfig` or `inputs.tsconfigs`, not both')
  }
  return options.tsconfig !== undefined
    ? strings([options.tsconfig], 'inputs.tsconfig')
    : options.tsconfigs !== undefined
      ? strings(options.tsconfigs, 'inputs.tsconfigs')
      : files.texts.has(path.join(files.root, 'tsconfig.json'))
        ? ['tsconfig.json']
        : []
}

/** The files `inputs.entrypoints` names, as an array or a subpath-to-path object. */
function selectedEntryFiles(options: ReturnType<typeof inputs>): string[] {
  const explicit = options.entrypoints
  const entryFiles =
    explicit === undefined
      ? []
      : Array.isArray(explicit)
        ? strings(explicit, 'inputs.entrypoints')
        : Object.values(record(explicit, 'inputs.entrypoints')).map(value => {
            if (typeof value !== 'string' || !value.trim()) {
              throw new Error('`inputs.entrypoints` values must be repository-relative filenames')
            }
            return value
          })
  if (explicit !== undefined && !entryFiles.length) throw new Error('`inputs.entrypoints` must not be empty')
  return entryFiles
}

/** Tracked sources, manifests and tsconfig files: what the compiler starts from. */
async function loadTracked(context: ExtractorContext, files: SourceFiles): Promise<void> {
  for (const file of context.files.toSorted()) {
    if (
      (sourceExtension.test(file) || path.basename(file) === 'package.json' || /^tsconfig.*\.json$/u.test(path.basename(file))) &&
      !file.split('/').includes('node_modules')
    ) {
      await containedPath(context, file)
      await files.load(path.join(files.root, file), true)
    }
  }
}

/** The programs' repository sources, outside `node_modules`, each with its program's checker. */
function programSources(files: SourceFiles, programs: Project['programs']): Project['sources'] {
  const sources: Project['sources'] = []
  const seen = new Set<string>()
  for (const program of programs) {
    for (const source of program.getSourceFiles()) {
      if (
        seen.has(source.fileName) ||
        !files.within(source.fileName) ||
        native(source.fileName).includes(`${path.sep}node_modules${path.sep}`)
      ) {
        continue
      }
      seen.add(source.fileName)
      if (sourceExtension.test(source.fileName)) sources.push({source, checker: program.getTypeChecker()})
    }
  }
  if (!sources.length) {
    throw new Error('No TypeScript/JavaScript sources found; provide tracked source files and `inputs.tsconfig` or `inputs.entrypoints`')
  }
  return sources.toSorted((a, b) => compareIds(a.source.fileName, b.source.fileName))
}

export async function projectFor(context: ExtractorContext): Promise<Project> {
  const options = inputs(context)
  const root = await sourcePath(context, '.')
  const files = new SourceFiles(context, root)
  await loadTracked(context, files)
  const configs = selectedConfigs(options, files)
  const entryFiles = selectedEntryFiles(options)
  for (const file of [...configs, ...entryFiles]) {
    await containedPath(context, file)
    await files.load(path.join(root, file), true)
  }
  const libraries = await readLibraries()
  const programs = await buildPrograms(files, createHosts(files, libraries), configs, entryFiles)
  const packages = apiPackages(files, programs, entryFiles)
  return {
    context,
    root,
    texts: files.texts,
    packages,
    programs,
    sources: programSources(files, programs),
    libraries: native(libraries.directory),
  }
}
