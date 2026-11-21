// The examined project: its own TypeScript compiler, its programs and the packages that own its sources.
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {compareIds, inputs, slash, sourceExtension} from './basics.mjs'

/**
 * The examined project's own `typescript` package, resolved as Node would from
 * the user's working checkout (`request.repository.checkout`), where the
 * project's dependencies are installed. Examined revisions omit ignored files
 * such as `node_modules`, so they can't supply it themselves. The checkout is
 * present only for trusted extractors.
 */
export function loadTypeScript(request) {
  const {checkout} = request.repository
  if (typeof checkout !== 'string') {
    throw new TypeError(
      "This extractor uses the project's own `typescript` package from your working checkout, which Projections provides only to trusted extractors; run with --trust.",
    )
  }
  const require = createRequire(path.join(checkout, 'package.json'))
  let resolved
  try {
    resolved = require.resolve('typescript')
  } catch {
    throw new Error(
      "This extractor uses the project's own `typescript` package, which is not installed in your working checkout. " +
        "Run your package manager's install (for example `npm ci`) first.",
    )
  }
  const ts = require(resolved)
  const major = Number.parseInt(ts.version, 10)
  if (!(major >= 5) || typeof ts.createProgram !== 'function') {
    throw new Error(`This extractor uses the TypeScript 5 or 6 compiler API; found typescript ${ts.version}.`)
  }
  return ts
}

function strings(value, label) {
  if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be a nonempty array of nonempty strings`)
  }
  return value
}

/** Repository files, excluding `.git` and installed packages. */
function files(root, prefix = '', result = []) {
  for (const entry of readdirSync(path.join(root, prefix), {withFileTypes: true}).sort((a, b) => compareIds(a.name, b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files(root, relative, result)
    else if (entry.isFile()) result.push(relative)
  }
  return result
}

/** The tsconfig files to build: `inputs.tsconfig`, `inputs.tsconfigs`, the root `tsconfig.json`, or none. */
function configFiles(root, options) {
  if (options.tsconfig !== undefined && options.tsconfigs !== undefined) {
    throw new Error('Use inputs.tsconfig or inputs.tsconfigs, not both')
  }
  if (options.tsconfig !== undefined) return strings([options.tsconfig], 'inputs.tsconfig')
  if (options.tsconfigs !== undefined) return strings(options.tsconfigs, 'inputs.tsconfigs')
  return existsSync(path.join(root, 'tsconfig.json')) ? ['tsconfig.json'] : []
}

/** Each configuration's roots, options and errors, following project references; strict ES2022 defaults without one. */
function configurations(ts, root, configs, listed) {
  const found = []
  const visited = new Set()
  const parseConfig = file => {
    if (visited.has(file)) return
    visited.add(file)
    const loaded = ts.readConfigFile(file, ts.sys.readFile)
    if (loaded.error) {
      throw new Error(`Invalid ${slash(path.relative(root, file))}: ${ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n')}`)
    }
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(file), {noEmit: true}, file)
    found.push({roots: parsed.fileNames, options: parsed.options, errors: parsed.errors})
    for (const reference of parsed.projectReferences ?? []) parseConfig(ts.resolveProjectReferencePath(reference))
  }
  for (const file of configs) parseConfig(path.resolve(root, file))
  if (!configs.length) {
    found.push({
      roots: listed.filter(file => sourceExtension.test(file)).map(file => path.join(root, file)),
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
      errors: [],
    })
  }
  return found
}

/** Fails on compiler errors: configuration, options, global and syntax errors, and semantic ones in `error` mode. */
function failOnErrors(ts, root, configured, programs, mode) {
  const diagnostics = configured.flatMap(configuration => configuration.errors)
  for (const program of programs) {
    diagnostics.push(...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics(), ...program.getSyntacticDiagnostics())
    if (mode === 'error') diagnostics.push(...program.getSemanticDiagnostics())
  }
  const errors = diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  if (!errors.length) return
  const location = diagnostic =>
    diagnostic.file && diagnostic.start !== undefined
      ? `${slash(path.relative(root, diagnostic.file.fileName))}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}: `
      : ''
  const text = errors
    .slice(0, 20)
    .map(diagnostic => `${location(diagnostic)}TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
    .join('\n')
  throw new Error(`TypeScript analysis failed; inputs.diagnostics="syntax" permits semantic type errors.\n${text}`)
}

/** The packages, deepest first: the nearest package.json owns each source, and package names are identities. */
function packagesOf(root, listed) {
  const packages = []
  for (const file of listed.filter(file => path.basename(file) === 'package.json')) {
    const manifest = JSON.parse(readFileSync(path.join(root, file), 'utf8'))
    const directory = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file)
    const name = typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name : directory || '(root)'
    if (packages.some(pkg => pkg.name === name)) throw new Error(`Duplicate package name "${name}"; package identities must be unique`)
    packages.push({name, directory})
  }
  if (!packages.some(pkg => !pkg.directory)) packages.push({name: '(root)', directory: ''})
  return packages.sort((a, b) => b.directory.length - a.directory.length || compareIds(a.name, b.name))
}

/** The repository's own source files across the programs, each with its program's checker, sorted by path. */
function sourcesOf(root, programs) {
  const within = file => {
    const relative = path.relative(root, file)
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
  }
  const sources = []
  const seen = new Set()
  for (const program of programs) {
    for (const source of program.getSourceFiles()) {
      if (seen.has(source.fileName) || !within(source.fileName) || source.fileName.includes('/node_modules/')) continue
      seen.add(source.fileName)
      if (sourceExtension.test(source.fileName)) sources.push({source, checker: program.getTypeChecker()})
    }
  }
  if (!sources.length) throw new Error('No TypeScript/JavaScript sources found; provide source files or inputs.tsconfig')
  return sources.sort((a, b) => compareIds(a.source.fileName, b.source.fileName))
}

/**
 * The project's TypeScript programs: those of `inputs.tsconfig` or
 * `inputs.tsconfigs` (with project references), the root `tsconfig.json`, or
 * otherwise every source file with strict ES2022 defaults. Compiler errors fail
 * the extraction unless `inputs.diagnostics` is `"syntax"`.
 */
export function project(request) {
  const root = path.resolve(request.repository.root)
  const ts = loadTypeScript(request)
  const options = inputs(request)
  const listed = files(root)
  const configs = configFiles(root, options)
  const mode = options.diagnostics ?? 'error'
  if (mode !== 'error' && mode !== 'syntax') throw new Error('inputs.diagnostics must be "error" or "syntax"')
  const configured = configurations(ts, root, configs, listed)
  const programs = configured
    .filter(configuration => configuration.roots.length)
    .map(configuration => ts.createProgram(configuration.roots, configuration.options))
  failOnErrors(ts, root, configured, programs, mode)
  const packages = packagesOf(root, listed)
  return {ts, request, root, packages, programs, sources: sourcesOf(root, programs)}
}
