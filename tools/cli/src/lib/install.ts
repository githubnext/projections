// The pure parts of `tools install`: development versions, where things go, and pointing a project at the packed
// `@githubnext/projections` tarball.
import {existsSync, realpathSync} from 'node:fs'
import {homedir} from 'node:os'
import {delimiter, isAbsolute, join, parse, relative, resolve, sep} from 'node:path'

export const PACKAGE = '@githubnext/projections'
/** The packed package, at a path that never changes, so `file:` references to it stay valid across updates. */
export const TARBALL = 'dist/dogfood/githubnext-projections.tgz'
export const VSIX = 'dist/dogfood/projections-vscode.vsix'
export const EXTENSION_ID = 'githubnext.projections-vscode'
export const parts = ['cli', 'vscode', 'npm'] as const
export type Part = (typeof parts)[number]
export const editors = ['auto', 'code', 'code-insiders', 'none'] as const
export type Editor = (typeof editors)[number]

/**
 * A development build's version: `<base>-dev.<commit>`, and `.dirty.<UTC timestamp>` for uncommitted changes, so each
 * build is a new version that VS Code and npm reinstall. The base keeps the CLI compatible (same major and minor).
 */
export function devVersion(base: string, commit: string, dirty: boolean, now = new Date()): string {
  const release = base.replace(/[-+].*$/u, '')
  // A numeric prerelease identifier can't have a leading zero; an all-digit hash gets git describe's `g` prefix.
  const id = /^\d+$/u.test(commit) ? `g${commit}` : commit
  const stamp = now.toISOString().replace(/\D/gu, '').slice(0, 14)
  return `${release}-dev.${id}${dirty ? `.dirty.${stamp}` : ''}`
}

/** vsce's platform target for this machine (Node's platform and architecture names). */
export function vsceTarget(platform: string = process.platform, arch: string = process.arch): string | undefined {
  const target = `${platform}-${arch === 'arm' ? 'armhf' : arch}`
  const known = ['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'linux-armhf', 'darwin-x64', 'darwin-arm64']
  return known.includes(target) ? target : undefined
}

export function defaultBinDir(home = homedir()): string {
  return join(home, '.local', 'bin')
}

/** The real path, or the absolute one when it doesn't exist. */
export function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** The first `name` on `PATH`. */
export function firstOnPath(name: string, path = process.env.PATH ?? ''): string | undefined {
  for (const directory of path.split(delimiter)) {
    const candidate = directory && join(directory, name)
    if (candidate && existsSync(candidate)) return candidate
  }
  return undefined
}

/** Paths on the command line are relative to where `npm run tools` was invoked, not the workspace root it runs in. */
export function fromInvocation(path: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), path)
}

/** Whether `directory` is on `PATH`. */
export function onPathList(directory: string, path = process.env.PATH ?? ''): boolean {
  const wanted = canonical(directory)
  return path.split(delimiter).some(entry => entry !== '' && canonical(entry) === wanted)
}

/**
 * The `file:` specifier for `tarball` from a project directory: relative when the two share a directory below the
 * filesystem root (a clone next to the project), else absolute (a different volume, or only `/` in common).
 */
export function tarballSpec(projectDirectory: string, tarball: string): string {
  const from = canonical(projectDirectory)
  const to = canonical(tarball)
  const fromTop = from.slice(parse(from).root.length).split(sep).find(Boolean)
  const toTop = to.slice(parse(to).root.length).split(sep).find(Boolean)
  const shared = parse(from).root === parse(to).root && fromTop !== undefined && fromTop === toTop
  const path = shared ? relative(from, to) : to
  return `file:${path.split(sep).join('/')}`
}

interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  overrides?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Points a project's `@githubnext/projections` dependency at `spec` (in devDependencies when it is there, else
 * dependencies) and removes an override of it that differs, which npm would reject. Returns what changed. A `file:`
 * specifier for the same file from `directory` (npm saves them relative) counts as the same.
 */
export function pointAtTarball(manifest: Manifest, spec: string, directory = '.'): {manifest: Manifest; changes: string[]} {
  const next: Manifest = structuredClone(manifest)
  const changes: string[] = []
  const file = (value: unknown) =>
    typeof value === 'string' && value.startsWith('file:') ? resolve(directory, value.slice('file:'.length)) : value
  const same = (value: unknown) => value === spec || file(value) === file(spec)
  const field =
    next.devDependencies?.[PACKAGE] !== undefined && next.dependencies?.[PACKAGE] === undefined ? 'devDependencies' : 'dependencies'
  const table = next[field] ?? {}
  next[field] = table
  if (!same(table[PACKAGE])) {
    changes.push(`${field}["${PACKAGE}"]: ${table[PACKAGE] ?? '(none)'} → ${spec}`)
    table[PACKAGE] = spec
  }
  if (next.overrides && PACKAGE in next.overrides && !same(next.overrides[PACKAGE])) {
    changes.push(`removed overrides["${PACKAGE}"] (${JSON.stringify(next.overrides[PACKAGE])})`)
    const {[PACKAGE]: _removed, ...overrides} = next.overrides
    if (Object.keys(overrides).length) next.overrides = overrides
    else delete next.overrides
  }
  return {manifest: next, changes}
}

/** Where an editor's command line may be: `PATH`, then the macOS application bundles. */
export function editorCandidates(editor: 'code' | 'code-insiders', platform: string = process.platform): string[] {
  const names = platform === 'win32' ? [`${editor}.cmd`, editor] : [editor]
  const fromPath = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .flatMap(directory => names.map(name => join(directory, name)))
  const app = editor === 'code' ? 'Visual Studio Code' : 'Visual Studio Code - Insiders'
  const bundles =
    platform === 'darwin'
      ? [
          `/Applications/${app}.app/Contents/Resources/app/bin/${editor}`,
          join(homedir(), `Applications/${app}.app/Contents/Resources/app/bin/${editor}`),
        ]
      : []
  return [...fromPath, ...bundles]
}

/** The editor command line to install into: the one asked for, or for `auto` `code`, else `code-insiders`. */
export function findEditor(editor: Editor, exists: (path: string) => boolean = existsSync): {name: string; path: string} | undefined {
  if (editor === 'none') return undefined
  for (const name of editor === 'auto' ? (['code', 'code-insiders'] as const) : [editor]) {
    const path = editorCandidates(name).find(candidate => isAbsolute(candidate) && exists(candidate))
    if (path) return {name, path}
  }
  return undefined
}

/** Environment without npm's `npm_config_*` and `npm_package_*` variables, so a project's npm uses its own config. */
export function withoutNpmConfig(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !/^npm_(?:config|package|lifecycle)_/iu.test(entry[0]),
    ),
  )
}
