import {readFile, readdir} from 'node:fs/promises'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {basename, dirname, extname, isAbsolute, relative, resolve, sep} from 'node:path'
import {spawnSync} from 'node:child_process'
import {builtinModules} from 'node:module'
import {fileURLToPath, pathToFileURL} from 'node:url'
import ts from 'typescript'
import {crateRules, layers} from './check-boundaries/layers.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const ignored = new Set([
  'node_modules',
  'dist',
  'target',
  'pkg',
  '.git',
  '.data',
  '.cache',
  '.venv',
  '__pycache__',
  'bin',
  'obj',
  'test-results',
  'playwright-report',
  'storybook-static',
  // VS Code downloaded by @vscode/test-electron for the extension's smoke test (gitignored).
  '.vscode-test',
])
// Source trees that must stay browser-portable, and workspaces that may not depend on execution packages.
const browserSources = [
  'packages/schemas/src/',
  'packages/machine/src/',
  'packages/engine/js/src/artifacts/',
  'packages/renderers/*/src/',
  'packages/host/core/src/',
  'packages/host/vscode-ui/src/',
]
const browserPackages = ['packages/schemas', 'packages/machine', 'packages/renderers/*', 'packages/host/core', 'packages/host/vscode-ui']
const executionPackages = new Set(['@githubnext/projections-typescript-support', '@githubnext/projections-cli'])
// Nothing here may mention a developer's machine or an agent's session state.
const privateReferences = [
  [/\/Users\/(?!me\/)[\w.-]+|\/home\/(?!dev\b|me\b|runner\b)[\w.-]+\/|[A-Z]:\\Users\\(?!me\\)/u, 'a machine-specific home directory'],
  [/copilot-worktrees|session-state|\.copilot\//u, 'agent session state'],
]
// Files that name these only to assert they are absent.
const referenceChecks = ['tools/scripts/check-boundaries.mjs']
// A repository that embeds this workspace beside code that must stay out of it adds its own rules: PROJECTIONS_BOUNDARY_RULES
// names an ES module (relative to where npm ran) whose default export is
//   {code?: RegExp[], references?: [RegExp, string][], scopes?: [string, string][], exempt?: string[]}
// `code` lines refer to code kept outside this workspace, anywhere; `references` are [pattern, what it names] that no file
// but the `exempt` ones (workspace-relative paths that assert absence) may mention; `scopes` are [package scope, why]
// that nothing may import or depend on.
const rulesModule = process.env['PROJECTIONS_BOUNDARY_RULES']
const extra = rulesModule ? (await import(pathToFileURL(resolve(process.env['INIT_CWD'] ?? process.cwd(), rulesModule)).href)).default : {}
const privateCode = extra.code ?? []
privateReferences.push(...(extra.references ?? []))
referenceChecks.push(...(extra.exempt ?? []))
const forbiddenScopes = extra.scopes ?? []
const forbiddenScope = name => forbiddenScopes.find(([scope]) => name.startsWith(scope))
const textFiles = new Set(['.md', '.json', '.yml', '.yaml', '.toml', '.rs', '.html', '.css', '.txt', '.sh'])
// First-party components get no privileges: built-in extractors, comparators and
// renderers depend on the public SDKs third parties use, never on the runner,
// CLI, host or runtime that runs them.
const projectionsPackage = /^@githubnext\/projections-/u
const rendererPackages = {
  // Package: allowed Projections production dependencies; development
  // dependencies may also use the public Engine and renderer testing tools.
  'packages/renderers/sdk': ['@githubnext/projections-schemas'],
  'packages/renderers/kit': ['@githubnext/projections-renderer-sdk', '@githubnext/projections-schemas'],
  'packages/renderers/*': [
    '@githubnext/projections-renderer-sdk',
    '@githubnext/projections-renderer-kit',
    '@githubnext/projections-schemas',
  ],
  'examples/renderers/*': ['@githubnext/projections-renderer-sdk', '@githubnext/projections-schemas'],
}
// Test tooling for renderers rather than renderers.
const rendererTooling = ['packages/renderers/testing', 'packages/renderers/harness']
const rendererDevelopment = [
  '@githubnext/projections-engine',
  '@githubnext/projections-renderer-testing',
  '@githubnext/projections-renderer-sdk',
  '@githubnext/projections-renderer-kit',
  '@githubnext/projections-schemas',
]
const rendererComparator = /^@githubnext\/projections-comparator-/u
const rendererSources = ['packages/renderers/*/src/', 'examples/renderers/*/src/']
const rendererForbidden = [
  '@githubnext/projections-host',
  '@githubnext/projections-inspector',
  '@githubnext/projections-cli',
  '@githubnext/projections-engine',
  '@githubnext/projections-comparator-runtime',
]
/** Workspace directory by package name, from the root manifest's workspaces. */
const workspaces = new Map(
  JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).workspaces.flatMap(entry => {
    const directories = entry.endsWith('/*')
      ? existsSync(resolve(root, entry.slice(0, -2)))
        ? readdirSync(resolve(root, entry.slice(0, -2)), {withFileTypes: true})
            .filter(item => item.isDirectory())
            .map(item => `${entry.slice(0, -1)}${item.name}`)
        : []
      : [entry]
    return directories
      .filter(directory => existsSync(resolve(root, directory, 'package.json')))
      .map(directory => [JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8')).name, directory])
  }),
)
const workspaceDirectories = [...workspaces.values()].sort((a, b) => b.length - a.length)
/** The workspace directory a repository-relative path belongs to. */
const workspaceOf = path => workspaceDirectories.find(directory => path === directory || path.startsWith(`${directory}/`))
// The renderers' and the kit's browser suites sit beside their code but run in the renderer harness
// (packages/renderers/harness/playwright.config.ts), so they import what the harness declares.
const harnessSuites = /^packages\/renderers\/[^/]+\/browser\//u
/** The first-party package an import specifier names, if any. */
const firstParty = specifier => {
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
  return workspaces.has(name) ? name : undefined
}
/** Paths inside a workspace that it ships: other workspaces' files are reached through their packages, never by path. */
const shipped = /^(?:src|build)\//u

const scripts = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/u, '')))
const failures = []
let modules = 0
let files = 0

const posix = path => relative(root, path).split(sep).join('/')
const pattern = glob =>
  new RegExp(
    `^${glob
      .split('*')
      .map(part => part.replace(/[.+?^${}()|[\]\\/]/gu, '\\$&'))
      .join('[^/]+')}${glob.endsWith('/') ? '' : '$'}`,
  )
const matches = (path, globs) => globs.some(glob => pattern(glob).test(path))
function escapes(target) {
  const path = relative(root, target)
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)
}
/** The nearest ancestor (or the file's own directory) holding the given manifest. */
function owner(path, manifest) {
  for (let directory = dirname(path); !escapes(directory); directory = dirname(directory)) {
    if (existsSync(resolve(directory, manifest))) return directory
    if (directory === dirname(directory)) break
  }
  return dirname(path)
}
/** A relative reference escapes when every plausible base directory resolves it outside the public root. */
function checkReference(path, reference, bases, label = 'path') {
  if (!/^\.\.(?:[\\/]|$)/u.test(reference)) return
  if (bases.every(base => escapes(resolve(base, reference)))) {
    failures.push(`${posix(path)}: ${label} escapes the public root: ${reference}`)
  }
}

function browserCallback(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === 'evaluate') {
      return true
    }
  }
  return false
}
function importMetaUrl(node) {
  return node && ts.isPropertyAccessExpression(node) && node.name.text === 'url' && ts.isMetaProperty(node.expression)
}

/** The workspace a module belongs to and the packages it may import: its own manifest's, and the harness's for suites. */
function importScope(path, sourcePath) {
  const pkg = owner(path, 'package.json')
  // Scaffolding templates and fixtures with their own package.json are not part of the workspace that holds them.
  const from = workspaceOf(sourcePath) === posix(pkg) ? posix(pkg) : undefined
  const runners = from ? (harnessSuites.test(sourcePath) ? [from, 'packages/renderers/harness'] : [from]) : []
  const declared = new Set(
    runners.flatMap(directory => {
      const manifest = JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8'))
      return [
        manifest.name,
        ...Object.keys({
          ...manifest.dependencies,
          ...manifest.devDependencies,
          ...manifest.peerDependencies,
          ...manifest.optionalDependencies,
        }),
      ]
    }),
  )
  return {pkg, from, runners, declared}
}

/** What is wrong with one import specifier of a module, or undefined. */
function importProblem(path, sourcePath, name, {from, runners, declared}) {
  const portable = matches(sourcePath, browserSources)
  if (name.startsWith('.')) {
    const target = fileURLToPath(new URL(name, pathToFileURL(path)))
    if (escapes(target)) return `${sourcePath}: import escapes the public workspace: ${name}`
    if (from && shipped.test(sourcePath.slice(from.length + 1))) {
      const to = workspaceOf(posix(target))
      if (to && to !== from) return `${sourcePath}: imports ${to}/ by path; depend on its package instead: ${name}`
    }
    return undefined
  }
  if (name.startsWith('/') || /^[a-zA-Z]:[\\/]/u.test(name) || name.startsWith('file:')) {
    return `${sourcePath}: absolute local import is not portable: ${name}`
  }
  if (matches(sourcePath, rendererSources) && rendererForbidden.includes(name.split('/').slice(0, 2).join('/'))) {
    return `${sourcePath}: a renderer imports ${name}; renderers use only the public renderer SDK and kit`
  }
  const scope = forbiddenScope(name)
  if (scope) return `${sourcePath}: forbidden import ${name}; ${scope[1]}`
  if (portable && (name.startsWith('node:') || builtins.has(name) || executionPackages.has(name.split('/').slice(0, 2).join('/')))) {
    return `${sourcePath}: forbidden host or execution import: ${name}`
  }
  // A first-party package a workspace imports is one it declares, so the layer table sees the edge.
  const dependency = firstParty(name)
  if (from && dependency && !declared.has(dependency)) {
    return `${sourcePath}: imports ${dependency}, which ${runners.join('/package.json or ')}/package.json doesn't declare`
  }
  return undefined
}

function inspectScript(path, text) {
  modules++
  const sourcePath = posix(path)
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const checked = new Set()
  const scope = importScope(path, sourcePath)
  const {pkg} = scope
  function check(specifier) {
    if (!specifier || !ts.isStringLiteralLike(specifier)) return
    checked.add(specifier)
    const name = specifier.text
    // Playwright callbacks resolve origin-relative URLs in the browser, not local files.
    if (name.startsWith('/') && !name.startsWith('//') && browserCallback(specifier)) return
    const problem = importProblem(path, sourcePath, name, scope)
    if (problem) failures.push(problem)
  }
  function walk(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) check(node.moduleSpecifier)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) check(node.argument.literal)
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      check(node.arguments[0])
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      importMetaUrl(node.arguments?.[1])
    ) {
      const first = node.arguments[0]
      const reference = first && (ts.isStringLiteralLike(first) ? first.text : ts.isTemplateExpression(first) ? first.head.text : undefined)
      if (reference !== undefined) {
        checked.add(first)
        checkReference(path, reference, [dirname(path)], 'module-relative URL')
      }
    }
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) && !checked.has(node)) {
      // Other relative strings may be resolved from the module, its package or the working directory.
      checkReference(path, node.text, [dirname(path), pkg])
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
}

function inspectRust(path, text) {
  const crate = owner(path, 'Cargo.toml')
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(/"(\/?\.\.\/[^"]*)"/gu)) {
      const reference = match[1].replace(/^\//u, '')
      const fileRelative = /(?:include(?:_str|_bytes)?!\s*\(|#\[path\s*=)\s*$/u.test(line.slice(0, match.index))
      checkReference(path, reference, [fileRelative ? dirname(path) : crate])
    }
  }
}

function inspectManifest(path, text) {
  const manifest = JSON.parse(text)
  const directory = dirname(path)
  const packagePath = posix(directory)
  for (const [kind, dependencies] of Object.entries({
    dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies,
    peerDependencies: manifest.peerDependencies,
    optionalDependencies: manifest.optionalDependencies,
  })) {
    for (const [dependency, version] of Object.entries(dependencies ?? {})) {
      if (kind !== 'devDependencies' && matches(packagePath, browserPackages) && executionPackages.has(dependency)) {
        failures.push(`${posix(path)}: forbidden production dependency ${dependency}`)
      }
      const scope = forbiddenScope(dependency)
      if (scope) failures.push(`${posix(path)}: forbidden dependency ${dependency}; ${scope[1]}`)
      const local = /^(?:file|link):(.*)$/u.exec(String(version))?.[1]
      if (local !== undefined && (isAbsolute(local) || escapes(resolve(directory, local)))) {
        failures.push(`${posix(path)}: ${dependency} uses a local package outside the public root: ${version}`)
      }
    }
  }
  if (packagePath !== '.') checkLayers(path, packagePath, manifest)
  const repositoryDirectory = manifest.repository?.directory
  if (repositoryDirectory !== undefined && repositoryDirectory !== packagePath) {
    failures.push(`${posix(path)}: repository.directory is ${repositoryDirectory}, but the package is in ${packagePath}`)
  }
  const rendererRule = rendererTooling.includes(packagePath)
    ? undefined
    : Object.entries(rendererPackages).find(([glob]) => matches(packagePath, [glob]))?.[1]
  if (rendererRule) {
    for (const [kind, dependencies] of Object.entries({
      dependencies: manifest.dependencies,
      peerDependencies: manifest.peerDependencies,
      optionalDependencies: manifest.optionalDependencies,
      devDependencies: manifest.devDependencies,
    })) {
      const allowed = kind === 'devDependencies' ? [...rendererRule, ...rendererDevelopment] : rendererRule
      for (const dependency of Object.keys(dependencies ?? {})) {
        // Tests may produce fixture comparisons with first-party comparator rules, run in the comparator runtime.
        const comparator = kind === 'devDependencies' && rendererComparator.test(dependency)
        if (projectionsPackage.test(dependency) && !allowed.includes(dependency) && !comparator) {
          failures.push(
            `${posix(path)}: a renderer ${kind === 'devDependencies' ? 'development ' : ''}dependency on ${dependency}; renderers use only the public renderer SDK and kit`,
          )
        }
      }
    }
  }
  for (const workspace of manifest.workspaces ?? []) {
    if (isAbsolute(workspace) || escapes(resolve(directory, workspace))) {
      failures.push(`${posix(path)}: workspace outside the public root: ${workspace}`)
    }
  }
}

/** A workspace's first-party dependencies follow the layer table. */
function checkLayers(path, packagePath, manifest) {
  if (!workspaces.has(manifest.name)) return
  const layer = layers.find(([glob]) => matches(packagePath, [glob]))
  if (!layer) {
    failures.push(`${posix(path)}: ${packagePath} has no place in the layer table (tools/scripts/check-boundaries/layers.mjs)`)
    return
  }
  const [, production, development] = layer
  for (const [kind, dependencies] of Object.entries({
    dependencies: manifest.dependencies,
    peerDependencies: manifest.peerDependencies,
    optionalDependencies: manifest.optionalDependencies,
    devDependencies: manifest.devDependencies,
  })) {
    const allowed = kind === 'devDependencies' ? [...production, ...development] : production
    for (const dependency of Object.keys(dependencies ?? {})) {
      const directory = workspaces.get(dependency)
      if (directory === undefined || allowed.includes(directory)) continue
      failures.push(
        development.includes(directory)
          ? `${posix(path)}: ${dependency} is a development-only dependency of ${packagePath} (layer table), not a ${kind} entry`
          : `${posix(path)}: ${packagePath} may not depend on ${directory} (${dependency}); see the layer table in tools/scripts/check-boundaries/layers.mjs`,
      )
    }
  }
}

function inspectTsconfig(path, text) {
  const {config, error} = ts.parseConfigFileTextToJson(path, text)
  if (error) {
    failures.push(`${posix(path)}: invalid tsconfig`)
    return
  }
  for (const reference of [config.extends, ...(config.references ?? []).map(item => item.path)].flat()) {
    if (typeof reference !== 'string') continue
    if (isAbsolute(reference)) failures.push(`${posix(path)}: tsconfig reference is absolute: ${reference}`)
    else checkReference(path, reference, [dirname(path)], 'tsconfig reference')
  }
}

/** The Projections crates a manifest depends on, as `[name, development]`. */
function crateDependencies(text) {
  const dependencies = []
  let section
  for (const line of text.split('\n')) {
    const header = /^\s*\[([^\]]+)\]\s*$/u.exec(line)
    if (header) {
      const name = header[1].trim()
      const table = /(?:^|\.)((?:dev-|build-)?dependencies)(?:\.(.+))?$/u.exec(name)
      section = table ? {development: table[1] === 'dev-dependencies', crate: table[2]?.replace(/["']/gu, '')} : undefined
      if (section?.crate) dependencies.push([section.crate, section.development])
      continue
    }
    const entry = /^\s*([\w-]+)\s*(?:\.|=)/u.exec(line)
    if (section && !section.crate && entry) dependencies.push([entry[1], section.development])
  }
  return dependencies.filter(([name]) => name.startsWith('projections-'))
}

function checkCrate(path, text) {
  const crate = posix(dirname(path))
  const rule = crateRules.find(({crates}) => matches(crate, [crates]))
  if (!rule) return
  const allows = (patterns, name) => patterns.some(pattern => (typeof pattern === 'string' ? pattern === name : pattern.test(name)))
  for (const [name, development] of crateDependencies(text)) {
    if (allows(rule.production, name) || (development && allows(rule.dev, name))) continue
    failures.push(
      `${posix(path)}: ${development ? 'development ' : ''}dependency on ${name}; first-party components use only the public SDKs, never the runner, CLI or comparator internals`,
    )
  }
}

function inspectToml(path, text) {
  checkCrate(path, text)
  for (const match of text.matchAll(/\bpath\s*=\s*"([^"]+)"/gu)) {
    if (isAbsolute(match[1])) failures.push(`${posix(path)}: Cargo path is absolute: ${match[1]}`)
    else if (escapes(resolve(dirname(path), match[1]))) failures.push(`${posix(path)}: Cargo path escapes the public root: ${match[1]}`)
  }
}

function inspectMarkdown(path, text) {
  for (const match of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/gu)) {
    if (!/^[a-z][a-z0-9+.-]*:/iu.test(match[1])) checkReference(path, match[1], [dirname(path)], 'link')
  }
}

function inspectPrivate(path, text) {
  const sourcePath = posix(path)
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    const found = privateCode.map(pattern => pattern.exec(line)).find(Boolean)
    if (found) failures.push(`${sourcePath}:${index + 1}: refers to private code kept outside this workspace (${found[0]})`)
    if (referenceChecks.includes(sourcePath)) continue
    for (const [pattern, what] of privateReferences) {
      const reference = pattern.exec(line)
      if (reference) failures.push(`${sourcePath}:${index + 1}: refers to ${what} (${reference[0]})`)
    }
  }
}

async function visit(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (ignored.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isSymbolicLink()) {
      failures.push(`${posix(path)}: authored public source must not depend on symlinks`)
      continue
    }
    if (entry.isDirectory()) {
      await visit(path)
      continue
    }
    const extension = extname(entry.name)
    if (scripts.includes(extension) || textFiles.has(extension) || (entry.name.startsWith('.') && !extension)) {
      inspectPrivate(path, await readFile(path, 'utf8'))
    }
    const inspect = scripts.includes(extension)
      ? inspectScript
      : extension === '.rs'
        ? inspectRust
        : entry.name === 'package.json'
          ? inspectManifest
          : /^tsconfig.*\.json$/u.test(entry.name)
            ? inspectTsconfig
            : entry.name === 'Cargo.toml'
              ? inspectToml
              : extension === '.md'
                ? inspectMarkdown
                : undefined
    if (!inspect) continue
    files++
    inspect(path, await readFile(path, 'utf8'))
  }
}

await visit(root)
// The public repository starts from a fresh commit of this tree, which drops any tracked file its own .gitignore matches.
const tracked = spawnSync('git', ['ls-files', '-z', '--cached', '--ignored', '--exclude-standard', '--', '.'], {
  cwd: root,
  encoding: 'utf8',
})
if (tracked.status === 0) {
  for (const file of tracked.stdout.split('\0').filter(Boolean)) {
    failures.push(`${file}: tracked but matched by .gitignore, so a fresh commit of this tree would leave it out`)
  }
}
if (failures.length) throw new Error(`Public dependency boundary violations:\n${failures.join('\n')}`)
console.log(
  `Public boundaries: ${files} authored files (${modules} source modules) stay inside ${basename(root)}/ with no parent/private imports or forbidden browser dependencies`,
)
