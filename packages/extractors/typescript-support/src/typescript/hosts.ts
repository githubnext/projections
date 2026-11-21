import path from 'node:path'
import {readdir, readFile} from 'node:fs/promises'
import ts from 'typescript'
import {glob} from '../shared.js'
import {slash} from './model.js'
import type {SourceFiles} from './files.js'

/** The compiler's own declaration libraries: the only files read outside the input boundary. */
export interface Libraries {
  directory: string
  texts: Map<string, string>
}

export async function readLibraries(): Promise<Libraries> {
  const directory = path.dirname(ts.getDefaultLibFilePath({}))
  const texts = new Map<string, string>()
  for (const name of await readdir(directory)) {
    if (/^lib(?:\..+)?\.d\.ts$/.test(name)) texts.set(path.join(directory, name), await readFile(path.join(directory, name), 'utf8'))
  }
  return {directory, texts}
}

export type Hosts = ReturnType<typeof createHosts>

/** Compiler hosts that read only loaded texts, recording what the compiler asks for that is not loaded yet. */
export function createHosts(files: SourceFiles, libraries: Libraries) {
  const {root, texts, aliases, missing, requested, requestedDirectories, directoryCache, within} = files
  const lookup = (file: string): string | undefined => {
    file = path.resolve(file)
    const text = texts.get(file) ?? libraries.texts.get(file)
    if (text === undefined && within(file) && !missing.has(file)) requested.add(file)
    return text
  }
  const directories = (): string[] =>
    [...texts.keys()].flatMap(file => {
      const result: string[] = []
      for (let current = path.dirname(file); within(current); current = path.dirname(current)) {
        result.push(current)
        if (current === root) break
      }
      return result
    })
  const configHost: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    fileExists: file => lookup(file) !== undefined,
    readFile: lookup,
    // Callers outside the compiler may leave out the extensions, which then means every file.
    readDirectory(directory, extensions: readonly string[] | undefined, excludes, includes, depth) {
      const base = path.resolve(directory)
      const compile = (patterns: readonly string[] | undefined): RegExp[] | undefined =>
        patterns?.flatMap(pattern => {
          const absolute = slash(path.resolve(base, pattern))
          return [glob(absolute), glob(`${absolute}/**`)]
        })
      const excluded = compile(excludes)
      const included = compile(includes)
      // Include patterns are absolute once resolved, so a tsconfig outside the
      // sources it includes (`"include": ["../../packages/api/src"]`) still matches them.
      return [...texts.keys()].filter(
        file =>
          !aliases.has(file) &&
          within(file) &&
          (included !== undefined || file.startsWith(`${base}${path.sep}`)) &&
          (!extensions || extensions.some(extension => file.endsWith(extension))) &&
          (depth === undefined || path.relative(base, file).split(path.sep).length <= depth + 1) &&
          !excluded?.some(pattern => pattern.test(slash(file))) &&
          (!included || included.some(pattern => pattern.test(slash(file)))),
      )
    },
  }
  const getDirectories = (directory: string): string[] => {
    directory = path.resolve(directory)
    if (!within(directory)) return []
    const cached = directoryCache.get(directory)
    if (cached) return cached
    requestedDirectories.add(directory)
    return [
      ...new Set(
        directories()
          .filter(dir => path.dirname(dir) === directory)
          .map(dir => path.basename(dir)),
      ),
    ]
  }
  /** A host for one configuration; `cache` holds the source files parsed under its options. */
  const compilerHost = (options: ts.CompilerOptions, cache: Map<string, ts.SourceFile>): ts.CompilerHost => ({
    ...ts.createCompilerHost(options),
    fileExists: file => lookup(file) !== undefined,
    readFile: lookup,
    directoryExists: directory => within(directory) || directory === libraries.directory,
    getDirectories,
    readDirectory: (...args) => [...configHost.readDirectory(...args)],
    realpath: file => aliases.get(path.resolve(file)) ?? path.resolve(file),
    getCurrentDirectory: () => root,
    getSourceFile(file, languageVersion) {
      const text = lookup(file)
      if (text === undefined) return undefined
      const version =
        typeof languageVersion === 'object'
          ? `${languageVersion.languageVersion}:${languageVersion.impliedNodeFormat ?? ''}`
          : String(languageVersion)
      const id = `${path.resolve(file)}\0${version}`
      let source = cache.get(id)
      if (!source) cache.set(id, (source = ts.createSourceFile(file, text, languageVersion, true)))
      return source
    },
    writeFile() {
      throw new Error('TypeScript extractors never emit files')
    },
  })
  return {lookup, configHost, compilerHost}
}
