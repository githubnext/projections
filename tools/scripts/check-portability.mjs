// Portability rule: what ships runs on Linux, macOS and Windows alike. Fails on operating-system assumptions in shipped
// code (packages/, including the CLI's templates, and the GitHub Action): POSIX shells and paths, string commands run
// through a shell, launchers named as only one platform names them, native paths handled as if they were POSIX, and
// file text split as if it never had CRLF line endings. Tests, fixtures and snapshots are not shipped and aren't read.
// Intentional exceptions are in .portability.yaml, each with its reason; an exception that no longer matches fails too.
// docs/maintainers/runner-coverage.md#platform-coverage describes the rules and which suites run on which platform.
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {parse} from 'yaml'

const script = /\.(?:[cm]?[jt]sx?)$/
const rust = /\.rs$/

/** Each rule: the files it reads, what a matching line looks like and what to do instead. */
export const rules = [
  {
    name: 'posix-shell',
    files: path => script.test(path) || rust.test(path) || /(^|\/)action\.ya?ml$/.test(path),
    pattern: /['"\x60]\/(?:usr\/(?:local\/)?)?bin\/[\w.-]+|Command::new\("(?:sh|bash|zsh)"\)/,
    advice: 'Windows has no /bin/sh or /usr/bin: run the program by name with argv (no shell), or select one per platform',
  },
  {
    name: 'shell-string',
    files: path => script.test(path),
    pattern:
      /\bshell:\s*true\b|\bimport\s*\{[^}]*\bexec(?:Sync)?\b[^}]*\}\s*from\s*['"](?:node:)?child_process['"]|\bchild_process\.exec(?:Sync)?\(/,
    advice: 'A command string is parsed by sh on one platform and cmd.exe on another: run argv with execFile or spawn, without a shell',
  },
  {
    name: 'bare-launcher',
    files: path => script.test(path),
    pattern: /\b(?:spawn|spawnSync|execFile|execFileSync)\(\s*['"\x60](?:(?:npm|npx|pnpm|yarn|corepack)(?:\.cmd)?|python3?|tar)['"\x60]/,
    advice:
      'npm, npx, pnpm and yarn are .cmd shims on Windows, which Node refuses to spawn without a shell (EINVAL), Windows names Python python or py, and on Windows the GNU tar of Git Bash comes first on PATH and reads C: as a remote host: run npm as node with npm_execpath, use %SystemRoot%\\System32\\tar.exe, or resolve the launcher per platform',
  },
  {
    name: 'rust-bare-launcher',
    files: path => rust.test(path),
    pattern: /Command::new\("(?:npm|npx|pnpm|yarn|python3?)"\)/,
    advice:
      'npm and its kin are .cmd shims on Windows (use npm.cmd there); Python is python or py -3 on Windows (run it through crate::python::launch)',
  },
  {
    name: 'posix-path-module',
    files: path => script.test(path),
    pattern: /\bpath\.posix\b|(?<![\w.])posix\.(?:join|resolve|relative|normalize|dirname|basename)\(/,
    advice: 'path.posix mishandles native Windows paths: use path for files, and path.posix only for repository paths and URLs',
  },
  {
    name: 'native-path-slash',
    files: path => script.test(path),
    pattern: /\b(?:relative|resolve|dirname|join)\([^()]*\)(?:\.split\(\s*['"\x60]\/['"\x60]\s*\)|\s*\+\s*['"\x60]\/)/,
    advice:
      "A native path has '\\' separators on Windows: split or extend it with path.sep (or path.join), or convert it to a repository path first",
  },
  {
    name: 'file-text-lf',
    files: path => script.test(path),
    pattern: /\breadFile(?:Sync)?\([^;]*\)[^;]*\.split\(\s*(?:'\\n'|"\\n"|\x60\\n\x60|\/\\n\/)\s*\)/,
    advice: 'A checkout on Windows may have CRLF line endings: split file text on /\\r?\\n/',
  },
  {
    name: 'path-equality',
    files: path => script.test(path),
    pattern: /\b(?:resolve|realpathSync)\([^()]*\)\s*[!=]==|[!=]==\s*(?:path\.)?(?:resolve|realpathSync)\(/,
    advice:
      'Paths compare case-insensitively on Windows and macOS, and a drive letter may differ in case: compare with a helper that allows for that, or use import.meta.main to ask whether a module is the entry point',
  },
  {
    name: 'rust-path-slash',
    files: path => rust.test(path),
    pattern: /\.join\("(?=[^"]*\/)(?!\/")[^"]*"\)/,
    advice:
      'Path::join("a/b") mixes separators on Windows, so the path no longer compares equal to the same path read back: join each segment',
  },
  {
    name: 'npm-script-posix',
    files: path => /(^|\/)package\.json$/.test(path),
    // Read against each script's command, which runs in cmd.exe on Windows.
    pattern: /(?:^|[\s&|;])(?:rm|cp|mv|mkdir|cat|chmod|ln|export)\s|(?:^|\s)[A-Z_][A-Z0-9_]*=\S|'|\$[A-Za-z{(]/,
    advice:
      "cmd.exe runs npm scripts on Windows: it has no rm, cp, export or VAR=value prefix, doesn't treat single quotes as quotes and doesn't expand $VAR; use a node script",
  },
]

/** Whether `path` (relative to the root, '/'-separated) is shipped code the rules read. */
export function shipped(path) {
  if (!(path.startsWith('packages/') || /^(?:\.github\/actions\/[^/]+\/)?action\.ya?ml$/.test(path))) return false
  if (/(?:^|\/)(?:test|tests|fixtures|snapshots|vendor|upstream|testdata|__tests__)\//.test(path)) return false
  // Playwright suites (browser/) are tests, except the CLI's own browser module, which ships.
  if (/(?:^|\/)browser\//.test(path) && !path.startsWith('packages/cli/src/')) return false
  return !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) && !/(?:^|\/)tests\.rs$/.test(path)
}

/** The rule violations in `text`, the content of `path`, each `{rule, line, text}`. */
export function findings(path, text) {
  const applicable = rules.filter(rule => rule.files(path))
  if (!applicable.length) return []
  // A Rust file's unit tests are its trailing #[cfg(test)] module; they aren't shipped.
  const tests = rust.test(path) ? text.search(/^#\[cfg\(test\)\]\s*\n\s*mod tests\b/m) : -1
  const source = tests >= 0 ? text.slice(0, tests) : text
  const lines = source.split(/\r?\n/)
  if (/(^|\/)package\.json$/.test(path)) {
    const scripts = JSON.parse(source).scripts ?? {}
    return Object.entries(scripts).flatMap(([name, command]) => {
      const number = lines.findIndex(scriptLine => scriptLine.trim().startsWith(`${JSON.stringify(name)}:`)) + 1
      return applicable
        .filter(rule => rule.pattern.test(command))
        .map(rule => ({rule: rule.name, line: number, text: `${JSON.stringify(name)}: ${JSON.stringify(command)}`}))
    })
  }
  return lines.flatMap((line, index) =>
    applicable
      // A shebang names the interpreter on POSIX only; Windows ignores it.
      .filter(rule => !(index === 0 && line.startsWith('#!')) && rule.pattern.test(line))
      .map(rule => ({rule: rule.name, line: index + 1, text: line.trim()})),
  )
}

/** The violations in `files` that `allowed` (the .portability.yaml entries) doesn't excuse, and its stale entries. */
export function check(files, allowed) {
  for (const entry of allowed) {
    if (!entry.path || !entry.rule || !entry.reason?.trim()) {
      throw new Error(`.portability.yaml: every entry needs a path, a rule and a reason: ${JSON.stringify(entry)}`)
    }
    if (!rules.some(rule => rule.name === entry.rule)) throw new Error(`.portability.yaml: no rule ${entry.rule}`)
  }
  const used = new Set()
  const violations = []
  for (const [path, text] of files) {
    for (const finding of findings(path, text)) {
      const entry = allowed.find(candidate => candidate.path === path && candidate.rule === finding.rule)
      if (entry) used.add(entry)
      else violations.push({path, ...finding})
    }
  }
  return {violations, stale: allowed.filter(entry => !used.has(entry))}
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const paths = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'packages', 'action.yml', '.github/actions'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(path => path && shipped(path) && rules.some(rule => rule.files(path)))
  const files = []
  for (const path of paths) {
    try {
      files.push([path, readFileSync(join(root, path), 'utf8')])
    } catch (error) {
      // A tracked file deleted in the working tree.
      if (error.code !== 'ENOENT') throw error
    }
  }
  const allowed = parse(readFileSync(join(root, '.portability.yaml'), 'utf8'))?.allow ?? []
  const {violations, stale} = check(files, allowed)
  const problems = [
    ...violations.map(
      ({path, line, rule, text}) => `${path}:${line}: ${rule}: ${text}\n  ${rules.find(item => item.name === rule).advice}`,
    ),
    ...stale.map(entry => `.portability.yaml: ${entry.path} no longer breaks ${entry.rule}; remove the entry`),
  ]
  if (problems.length) {
    throw new Error(
      `Shipped code must run on Linux, macOS and Windows (docs/maintainers/runner-coverage.md#platform-coverage); fix each, or add an exception with its reason to .portability.yaml:\n${problems.join('\n')}`,
    )
  }
  console.log(
    `Portability: ${files.length} shipped files make no operating-system assumptions beyond the ${allowed.length} in .portability.yaml`,
  )
}
