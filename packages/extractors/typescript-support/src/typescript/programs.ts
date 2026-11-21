import path from 'node:path'
import ts from 'typescript'
import {escape, slash, sourceExtension} from './model.js'
import type {SourceFiles} from './files.js'
import type {Hosts} from './hosts.js'

interface Configuration {
  roots: string[]
  options: ts.CompilerOptions
}

/** Cannot find module, its declarations, or its types. */
const UNRESOLVED_MODULE = new Set([2307, 2792, 7016])
/** No inputs were found in config file. */
const NO_INPUTS = 18003

function diagnosticText(root: string, diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .slice(0, 20)
    .map(diagnostic => {
      const location =
        diagnostic.file && diagnostic.start !== undefined
          ? `${slash(path.relative(root, diagnostic.file.fileName))}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}: `
          : ''
      return escape(
        `${location}TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split(root).join('<repository>')}`,
      )
    })
    .join('\n')
}

/**
 * With entry points, each configuration's roots are the entry points it covers,
 * so the program holds only what they reach: a tsconfig's tests and scripts,
 * whose dependencies may not be installed, are neither parsed nor checked. An
 * entry point no configuration covers takes the first one's options.
 */
function scopeToEntries(result: Configuration[], entries: string[]): void {
  const covered = new Set<string>()
  for (const configuration of result) {
    const files = new Set(configuration.roots.map(file => path.resolve(file)))
    configuration.roots = entries.filter(file => files.has(file))
    for (const file of configuration.roots) covered.add(file)
  }
  const uncovered = entries.filter(file => !covered.has(file))
  if (uncovered.length && result[0]) result[0].roots.push(...uncovered)
}

/** The configurations `configs` name, following project references; without any, one over the entry points or every source. */
function configurations(files: SourceFiles, hosts: Hosts, configs: string[], entryFiles: string[], diagnostics: ts.Diagnostic[]) {
  const {root, texts, aliases, within} = files
  const result: Configuration[] = []
  const visited = new Set<string>()
  const parseConfig = (file: string): void => {
    if (visited.has(file)) return
    visited.add(file)
    const loaded = ts.readConfigFile(file, hosts.lookup)
    if (loaded.error) {
      diagnostics.push(loaded.error)
      return
    }
    const parsed = ts.parseJsonConfigFileContent(loaded.config, hosts.configHost, path.dirname(file), {noEmit: true}, file)
    // Entry points are the roots when given, so a configuration without inputs of its own is fine.
    diagnostics.push(...parsed.errors.filter(error => !(entryFiles.length && error.code === NO_INPUTS)))
    result.push({roots: parsed.fileNames, options: parsed.options})
    for (const reference of parsed.projectReferences ?? []) {
      const target = ts.resolveProjectReferencePath(reference)
      if (within(target)) parseConfig(target)
      else throw new Error('TypeScript project references must stay within the repository')
    }
  }
  for (const file of configs) parseConfig(path.resolve(root, file))
  if (configs.length && entryFiles.length) {
    scopeToEntries(
      result,
      entryFiles.map(file => path.resolve(root, file)),
    )
  }
  if (!configs.length) {
    result.push({
      roots: entryFiles.length
        ? entryFiles.map(file => path.resolve(root, file))
        : [...texts.keys()].filter(
            file => sourceExtension.test(file) && !aliases.has(file) && !file.includes(`${path.sep}node_modules${path.sep}`),
          ),
      options: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        allowJs: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
    })
  }
  return result
}

/**
 * The checked programs of the selected configurations. Each pass builds them
 * from the loaded texts and loads what the compiler asked for; the passes repeat
 * until resolution settles.
 */
export async function buildPrograms(files: SourceFiles, hosts: Hosts, configs: string[], entryFiles: string[]): Promise<ts.Program[]> {
  // Loaded texts never change, so each configuration parses (and binds) a file once
  // across resolution passes, as the language service's document registry does.
  // Programs themselves are rebuilt: reusing one would keep its failed resolutions.
  const parsed = new Map<string, Map<string, ts.SourceFile>>()
  let programs: ts.Program[] = []
  let diagnostics: ts.Diagnostic[] = []
  let settled = false
  for (let iteration = 0; iteration < 64; iteration++) {
    files.clearRequests()
    diagnostics = []
    programs = configurations(files, hosts, configs, entryFiles, diagnostics)
      .filter(configuration => configuration.roots.length)
      .map(configuration => {
        const key = JSON.stringify(configuration.options)
        const cache = parsed.get(key) ?? new Map<string, ts.SourceFile>()
        parsed.set(key, cache)
        return ts.createProgram(configuration.roots, configuration.options, hosts.compilerHost(configuration.options, cache))
      })
    if (await files.loadRequested()) continue
    // Checking is the expensive step, so it runs only once resolution has settled.
    // Should it ever consult a file resolution missed, the pass simply repeats.
    for (const program of programs) {
      diagnostics.push(...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics(), ...program.getSyntacticDiagnostics())
      // Unresolved dependencies must never be published as success-shaped `any` signatures.
      diagnostics.push(...program.getSemanticDiagnostics())
    }
    if (!(await files.loadRequested())) {
      settled = true
      break
    }
  }
  if (!settled) {
    throw new Error('TypeScript module/config resolution exceeded 64 passes; simplify `inputs.tsconfigs` or check dependency cycles')
  }
  const errors = diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  if (errors.length) {
    const unresolved = errors.some(diagnostic => UNRESOLVED_MODULE.has(diagnostic.code))
    const guidance = unresolved
      ? "Public API collection requires resolved dependencies and valid types. Some modules didn't resolve: install the repository's dependencies, or set `inputs.entrypoints` so the program holds only what the public API reaches."
      : 'Public API collection requires resolved dependencies and valid types.'
    throw new Error(
      `TypeScript analysis failed. Fix the project or select \`inputs.tsconfig\` or \`inputs.entrypoints\`. ${guidance}\n${diagnosticText(files.root, errors)}`,
    )
  }
  return programs
}
