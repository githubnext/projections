// The public TypeScript API must be documented: every symbol a workspace's package.json `exports` (or `types`) reaches,
// following re-exports, needs a TSDoc summary, as do the public members of the interfaces and classes whose member
// tables the reference pages print. `@internal` opts a symbol out (one exported only for tests or tooling); vendored
// files (a leading `// Adapted from` header) are documented upstream. Read with the TypeScript checker from each
// workspace's sources and tsconfig, so no build is needed. See CONTRIBUTING.md, Documentation comments.
import {readFile, readdir} from 'node:fs/promises'
import {join, posix, relative} from 'node:path'
import ts from 'typescript'
import {apiPageWorkspaces} from './api.mjs'
import {exists, root} from './shared.mjs'

/** The opt-out for a symbol exported only for tests or tooling. */
const optOut = 'internal'
const codeExtensions = ['.ts', '.tsx', '.mts', '.cts']

/** A vendored third-party file, kept as upstream ships it (packages/host/core/src/ui/components): its header says so. */
const vendored = source => /^\/\/ Adapted from /m.test(source.text.slice(0, 200))

const toPosix = path => path.replaceAll('\\', '/')
const repositoryPath = path => toPosix(relative(root, path))

/** The workspace directories the root package.json lists, with `dir/*` patterns expanded. */
async function workspaces() {
  const {workspaces: patterns} = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const found = []
  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) {
      found.push(pattern)
      continue
    }
    const parent = pattern.slice(0, -2)
    for (const entry of (await readdir(join(root, parent), {withFileTypes: true})).toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && (await exists(`${parent}/${entry.name}/package.json`))) found.push(`${parent}/${entry.name}`)
    }
  }
  return found
}

/** The declaration file an export condition names: `types` first, then any target that is already TypeScript. */
function typedTarget(target) {
  if (typeof target === 'string') return codeExtensions.some(extension => target.endsWith(extension)) ? target : undefined
  if (!target || typeof target !== 'object') return undefined
  if (typeof target.types === 'string') return target.types
  for (const value of Object.values(target)) {
    const found = typedTarget(value)
    if (found) return found
  }
  return undefined
}

/** The source a declaration path was built from: itself when it is hand-written, else under the tsconfig's `rootDir`. */
async function sourceOf(workspace, target, options) {
  const path = posix.normalize(`${workspace}/${target}`)
  if (!/\.d\.[cm]?ts$/.test(path) && (await exists(path))) return path
  const outDir = options.outDir ? repositoryPath(options.outDir) : `${workspace}/dist`
  const rootDir = options.rootDir ? repositoryPath(options.rootDir) : `${workspace}/src`
  if (path.startsWith(`${outDir}/`)) {
    const stem = `${rootDir}/${path.slice(outDir.length + 1)}`.replace(/\.d\.([cm]?)ts$/, '')
    for (const extension of ['.ts', '.tsx']) if (await exists(`${stem}${extension}`)) return `${stem}${extension}`
  }
  // A hand-written declaration file beside its JavaScript (build/*.d.mts) is the source consumers read.
  if (await exists(path)) return path
  return undefined
}

/** Each public entry point of `workspace`: `{subpath, file}`, from `exports` or, without them, `types`. */
async function entryPoints(workspace, options) {
  const manifest = JSON.parse(await readFile(join(root, workspace, 'package.json'), 'utf8'))
  const targets = manifest.exports
    ? typeof manifest.exports === 'string' || !Object.keys(manifest.exports).every(key => key.startsWith('.'))
      ? [['.', manifest.exports]]
      : Object.entries(manifest.exports)
    : [['.', manifest.types ?? manifest.typings]]
  const found = []
  for (const [subpath, target] of targets) {
    // Wildcards export asset directories (built bundles, fixtures, icons), not an API.
    if (subpath.includes('*')) continue
    const declaration = typedTarget(target)
    if (!declaration) continue
    const file = await sourceOf(workspace, declaration, options)
    if (file) found.push({subpath, file, name: posix.join(manifest.name, subpath)})
  }
  return found
}

function compilerOptions(workspace) {
  const config = join(root, workspace, 'tsconfig.json')
  const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, {...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {}})
  return {...parsed?.options, noEmit: true, allowJs: true}
}

/** The documentation comment's summary, or `undefined` when it has none; `false` when it opts out. */
function summaryOf(declaration) {
  const docs = ts.getJSDocCommentsAndTags(declaration).filter(ts.isJSDoc)
  if (docs.some(doc => doc.tags?.some(tag => tag.tagName.text === optOut))) return false
  const text = docs.map(doc => ts.getTextOfJSDocComment(doc.comment) ?? '').join('\n')
  return text.trim() || undefined
}

/** Whether a symbol is documented: any of its declarations (overloads, merged interfaces, accessor pairs) is. */
function documented(symbol) {
  const summaries = (symbol.declarations ?? []).map(summaryOf)
  if (summaries.includes(false)) return 'internal'
  return summaries.some(Boolean)
}

const memberKinds = new Set([
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
])
const isPublicMember = member =>
  memberKinds.has(member.kind) && !ts.isPrivateIdentifier(member.name) && !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private)

function location(declaration) {
  const source = declaration.getSourceFile()
  const node = ts.getNameOfDeclaration(declaration) ?? declaration
  return {file: repositoryPath(source.fileName), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}
}

/**
 * The public symbols of every workspace: `{workspace, documented, undocumented}` counts and the problems, one per
 * undocumented symbol or member, each `{file, line, message}`. A symbol is checked once, in the workspace whose
 * sources declare it, wherever else it is re-exported.
 */
export async function publicApiDocs() {
  const problems = []
  const coverage = []
  const seen = new Set()
  for (const workspace of await workspaces()) {
    if (!(await exists(`${workspace}/tsconfig.json`))) continue
    const options = compilerOptions(workspace)
    const entries = await entryPoints(workspace, options)
    if (!entries.length) continue
    const program = ts.createProgram(
      entries.map(entry => join(root, entry.file)),
      options,
    )
    const checker = program.getTypeChecker()
    const own = source => {
      const path = repositoryPath(source.fileName)
      return path.startsWith(`${workspace}/`) && !path.includes('/node_modules/') && !vendored(source)
    }
    const members = apiPageWorkspaces.includes(workspace)
    const counts = {workspace, documented: 0, undocumented: 0}
    const check = (symbol, label, exportedFrom, declarations) => {
      const declaration = declarations[0]
      const key = `${declaration.getSourceFile().fileName}:${declaration.pos}:${label}`
      if (seen.has(key)) return true
      seen.add(key)
      const state = documented(symbol)
      if (state === 'internal') return false
      if (state) counts.documented++
      else {
        counts.undocumented++
        problems.push({...location(declaration), message: `${label} is public (${exportedFrom}) but has no TSDoc summary`})
      }
      return true
    }
    const visitModule = (module, exportedFrom, path) => {
      for (const exported of checker.getExportsOfModule(module)) {
        const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
        const declarations = (symbol.declarations ?? []).filter(declaration => own(declaration.getSourceFile()))
        if (!declarations.length) continue
        const name = path ? `${path}.${exported.name}` : exported.name
        // `export * as name`: the namespace's own exports are public.
        if (declarations.every(ts.isSourceFile)) {
          if (!seen.has(`module:${symbol.name}`)) {
            seen.add(`module:${symbol.name}`)
            visitModule(symbol, exportedFrom, name)
          }
          continue
        }
        if (!check(symbol, `\`${name}\``, exportedFrom, declarations) || !members) continue
        for (const declaration of declarations) {
          if (!ts.isInterfaceDeclaration(declaration) && !ts.isClassDeclaration(declaration)) continue
          for (const member of declaration.members) {
            if (!isPublicMember(member)) continue
            const memberSymbol = checker.getSymbolAtLocation(member.name)
            if (memberSymbol) check(memberSymbol, `\`${name}.${member.name.getText()}\``, exportedFrom, [member])
          }
        }
      }
    }
    for (const entry of entries) {
      const source = program.getSourceFile(join(root, entry.file))
      const module = source && checker.getSymbolAtLocation(source)
      if (module) visitModule(module, `\`${entry.name}\``, '')
    }
    coverage.push(counts)
  }
  problems.sort((a, b) => a.file.localeCompare(b.file, 'en') || a.line - b.line)
  return {problems, coverage}
}
