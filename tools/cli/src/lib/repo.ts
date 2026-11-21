// The repository on disk: its root, files, git and processes.
import {spawn, spawnSync} from 'node:child_process'
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'

/** The workspace root: the directory holding this package's parent, `tools/` (this package is `tools/cli/`). */
export const workspaceRoot = resolve(import.meta.dirname, '../../../..')

/** Directories never walked: dependencies, build output and caches. */
export const ignoredDirectories = new Set([
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
  '.vscode-test',
  '.package',
])

/** POSIX form of a relative path. */
export function posix(path: string): string {
  return path.split(sep).join('/')
}

export function readText(root: string, path: string): string | undefined {
  try {
    return readFileSync(join(root, path), 'utf8')
  } catch {
    return undefined
  }
}

export function readJson<T = unknown>(root: string, path: string): T | undefined {
  const text = readText(root, path)
  return text === undefined ? undefined : (JSON.parse(text) as T)
}

/** Every file under `directory` (relative to `root`), skipping ignored directories, as POSIX relative paths. */
export function walk(root: string, directory = '.', filter: (path: string) => boolean = () => true): string[] {
  const found: string[] = []
  const visit = (relativeDirectory: string) => {
    let entries
    try {
      entries = readdirSync(join(root, relativeDirectory), {withFileTypes: true})
    } catch {
      return
    }
    for (const entry of entries) {
      const path = relativeDirectory === '.' ? entry.name : `${relativeDirectory}/${entry.name}`
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith('.')) visit(path)
      } else if (entry.isFile() && filter(path)) found.push(path)
    }
  }
  visit(posix(directory))
  return found.sort()
}

/** The newest modification time (ms) of any file under `directory`, or undefined when it has none. */
export function newestMtime(
  root: string,
  directory: string,
  filter?: (path: string) => boolean,
): {path: string; mtime: number} | undefined {
  let newest: {path: string; mtime: number} | undefined
  for (const path of walk(root, directory, filter)) {
    const mtime = statSync(join(root, path)).mtimeMs
    if (!newest || mtime > newest.mtime) newest = {path, mtime}
  }
  return newest
}

/** The newest modification time of files directly in or below a build output directory (not skipping it). */
export function newestOutput(root: string, directory: string): number | undefined {
  const absolute = join(root, directory)
  if (!existsSync(absolute)) return undefined
  let newest: number | undefined
  const visit = (path: string) => {
    for (const entry of readdirSync(path, {withFileTypes: true})) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile()) newest = Math.max(newest ?? 0, statSync(child).mtimeMs)
    }
  }
  visit(absolute)
  return newest
}

/** Glob matching for repository paths: `*` within a segment, `**` across segments. */
export function globToRegExp(glob: string): RegExp {
  let pattern = ''
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!
    if (char === '*' && glob[index + 1] === '*') {
      const slash = glob[index + 2] === '/'
      pattern += slash ? '(?:.*/)?' : '.*'
      index += slash ? 2 : 1
    } else if (char === '*') pattern += '[^/]*'
    else if (char === '?') pattern += '[^/]'
    else pattern += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char
  }
  return new RegExp(`^${pattern}$`)
}

export function matches(path: string, globs: readonly string[]): boolean {
  return globs.some(glob => globToRegExp(glob).test(path))
}

/** Expands a Cargo or npm workspace member pattern: a literal directory or one trailing `/*` level. */
export function expandMember(root: string, pattern: string, marker: string): string[] {
  if (!pattern.endsWith('/*')) return existsSync(join(root, pattern, marker)) ? [pattern] : []
  const parent = pattern.slice(0, -2)
  try {
    return readdirSync(join(root, parent), {withFileTypes: true})
      .filter(entry => entry.isDirectory() && existsSync(join(root, parent, entry.name, marker)))
      .map(entry => `${parent}/${entry.name}`)
      .sort()
  } catch {
    return []
  }
}

// ── git ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function git(root: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
  return result.status === 0 ? result.stdout.trimEnd() : undefined
}

// ── processes ──────────────────────────────────────────────────────────────────────────────────────────────────

/** `env` adds to this process's environment, or with `replaceEnv` is the whole environment. */
export interface Command {
  argv: readonly string[]
  env?: Readonly<Record<string, string>>
  cwd?: string
  replaceEnv?: boolean
}

export interface Ran {
  command: string
  exitCode: number
  output: string
  durationMs: number
  missing?: string
}

/** The shell-like display form of a command. */
export function display(command: Command): string {
  const env = command.replaceEnv ? [] : Object.entries(command.env ?? {}).map(([key, value]) => `${key}=${value}`)
  const quote = (word: string) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`)
  return [...env, ...command.argv.map(quote)].join(' ')
}

/** Resolves `npm` and `node` to the running Node's, so commands use the same toolchain as this process. */
function executable(name: string): {file: string; prefix: string[]} {
  if (name === 'node') return {file: process.execPath, prefix: []}
  if (name === 'npm' && process.env.npm_execpath) return {file: process.execPath, prefix: [process.env.npm_execpath]}
  if (name === 'npx' && process.env.npm_execpath) {
    const npx = process.env.npm_execpath.replace(/npm-cli\.js$/, 'npx-cli.js')
    if (existsSync(npx)) return {file: process.execPath, prefix: [npx]}
  }
  return {file: name, prefix: []}
}

/** Runs a command to completion, capturing interleaved output (bounded to the last `limit` bytes). */
export function run(root: string, command: Command, options: {limit?: number; echo?: boolean} = {}): Promise<Ran> {
  const limit = options.limit ?? 4 * 1024 * 1024
  const started = Date.now()
  const [name, ...args] = command.argv
  const {file, prefix} = executable(name!)
  return new Promise(resolvePromise => {
    let output = ''
    const append = (chunk: Buffer) => {
      if (options.echo) process.stderr.write(chunk)
      output += chunk.toString('utf8')
      if (output.length > limit * 2) output = output.slice(-limit)
    }
    const child = spawn(file, [...prefix, ...args], {
      cwd: command.cwd ? resolve(root, command.cwd) : root,
      env: {...(command.replaceEnv ? {} : process.env), FORCE_COLOR: '0', NO_COLOR: '1', ...command.env},
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error: NodeJS.ErrnoException) => {
      resolvePromise({
        command: display(command),
        exitCode: 127,
        output: String(error.message),
        durationMs: Date.now() - started,
        ...(error.code === 'ENOENT' ? {missing: name!} : {}),
      })
    })
    child.on('close', code => {
      resolvePromise({command: display(command), exitCode: code ?? 1, output: output.slice(-limit), durationMs: Date.now() - started})
    })
  })
}

/** Runs a short command synchronously, returning trimmed stdout, or undefined when it fails or is missing. */
export function probe(root: string, argv: readonly string[]): string | undefined {
  const [name, ...args] = argv
  const {file, prefix} = executable(name!)
  const result = spawnSync(file, [...prefix, ...args], {cwd: root, encoding: 'utf8', timeout: 20_000})
  return result.status === 0 ? `${result.stdout}${result.stderr}`.trim() : undefined
}

/** Whether `name` resolves on PATH. */
export function onPath(name: string): boolean {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']
  return (process.env.PATH ?? '')
    .split(process.platform === 'win32' ? ';' : ':')
    .some(directory => extensions.some(extension => directory && existsSync(join(directory, `${name}${extension}`))))
}

/** Makes `path` relative to `root` when it is inside it; otherwise returns it unchanged. */
export function relativeTo(root: string, path: string): string {
  if (!isAbsolute(path)) return posix(path)
  const relativePath = relative(root, path)
  return relativePath.startsWith('..') || isAbsolute(relativePath) ? path : posix(relativePath)
}
