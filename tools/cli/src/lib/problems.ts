// Turning tool output into `{file, line, message}` problems: TypeScript, ESLint, oxfmt, rustc/clippy, rustfmt, cargo
// test, node:test, the repository's check scripts, and a generic `path:line` fallback.
import {posix} from './repo.ts'

/** Text that YAML may have quoted in single quotes, without them. */
const unquoted = (text: string) => text.replace(/^'/u, '').replace(/'$/u, '')

/** An ESLint stylish error line, `  12:5  error  message  rule`: the message ends where the last run of 2+ spaces starts. */
function stylishError(line: string): {line: number; message: string; rule: string} | undefined {
  const row = /^\s+(\d+):\d+\s+error\s(.*)$/u.exec(line)
  if (!row) return undefined
  const rest = (row[2] ?? '').trimStart()
  const tail = /\s{2,}([\w@/-]+)$/u.exec(rest)
  if (!tail || tail.index === 0) return undefined
  return {line: Number(row[1]), message: rest.slice(0, tail.index), rule: tail[1] ?? ''}
}

export interface Problem {
  file: string | undefined
  line: number | undefined
  message: string
}

// eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC.
const ansi = /\x1b\[[0-9;]*[A-Za-z]/gu

/** Paths relative to the workspace root: strips the root, `file://` and a workspace directory prefix. */
export function normalizePath(path: string, root: string, cwd = ''): string {
  let normalized = path.replace(/^file:\/\//u, '').trim()
  const rootPrefix = `${posix(root)}/`
  normalized = posix(normalized)
  if (normalized.startsWith(rootPrefix)) return normalized.slice(rootPrefix.length)
  if (normalized.startsWith('/')) return normalized
  return cwd ? `${cwd}/${normalized.replace(/^\.\//u, '')}` : normalized.replace(/^\.\//u, '')
}

function push(problems: Problem[], seen: Set<string>, problem: Problem) {
  const key = `${problem.file}:${problem.line}:${problem.message}`
  if (seen.has(key)) return
  seen.add(key)
  problems.push({...problem, message: problem.message.trim().slice(0, 300)})
}

/** Every problem found in `output`, in order and deduplicated. `cwd` is the directory relative paths start from. */
export function parseProblems(output: string, root: string, cwd = ''): Problem[] {
  const problems: Problem[] = []
  const seen = new Set<string>()
  const lines = output.replace(ansi, '').replaceAll('\r\n', '\n').split('\n')
  // npm prints `> @scope/name@0.0.0 build` and then runs in that workspace; tsc paths are relative to it.
  let directory = cwd
  let eslintFile: string | undefined
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    const workspace = /^npm (?:error|ERR!) path (.+)$/u.exec(line)
    if (workspace) directory = normalizePath(workspace[1]!, root)
    // TypeScript: src/a.ts(12,5): error TS2322: message
    let match = /^(.+?)\((\d+),\d+\): error (TS\d+: .+)$/u.exec(line)
    if (match) {
      push(problems, seen, {file: normalizePath(match[1]!, root, directory), line: Number(match[2]), message: match[3]!})
      continue
    }
    // TypeScript (pretty) and vite/esbuild: src/a.ts:12:5 - error TS2322: message
    match = /^(.+?\.[cm]?[jt]sx?):(\d+):\d+ - error (TS\d+: .+)$/u.exec(line)
    if (match) {
      push(problems, seen, {file: normalizePath(match[1]!, root, directory), line: Number(match[2]), message: match[3]!})
      continue
    }
    // rustc and clippy: error[E0308]: message / warning: message, then `  --> path:line:col`
    match = /^(error|warning)(\[[^\]]+\])?: (.+)$/u.exec(line)
    if (match && !/^(?:error|warning): (?:could not compile|aborting|build failed|\d+ warnings? emitted|unused manifest key)/u.test(line)) {
      const location = lines.slice(index + 1, index + 4).find(next => /^\s+--> /u.test(next))
      const at = location && /--> (.+?):(\d+):\d+/u.exec(location)
      if (at) {
        push(problems, seen, {
          file: normalizePath(at[1]!, root),
          line: Number(at[2]),
          message: `${match[1]}${match[2] ?? ''}: ${match[3]}`,
        })
        continue
      }
    }
    // clippy/rustc --message-format short: path:line:col: error: message
    match = /^([\w./-]+\.rs):(\d+):\d+: (error|warning)(?:\[[^\]]+\])?: (.+)$/u.exec(line)
    if (match) {
      push(problems, seen, {file: normalizePath(match[1]!, root), line: Number(match[2]), message: `${match[3]}: ${match[4]}`})
      continue
    }
    // rustfmt --check: Diff in /abs/path.rs:12: (or "at line 12:")
    match = /^Diff in (.+?\.rs)(?::(\d+)| at line (\d+)):?$/u.exec(line)
    if (match) {
      push(problems, seen, {
        file: normalizePath(match[1]!, root),
        line: Number(match[2] ?? match[3]),
        message: 'not formatted (cargo fmt)',
      })
      continue
    }
    // cargo test: thread 'name' panicked at path.rs:12:5: then the message on the next line(s)
    match = /^thread '(.+?)' panicked at (.+?\.rs):(\d+):\d+:?$/u.exec(line)
    if (match) {
      const message = lines
        .slice(index + 1, index + 4)
        .filter(next => next && !next.startsWith('note:') && !next.startsWith('stack backtrace'))
        .join(' ')
      push(problems, seen, {file: normalizePath(match[2]!, root), line: Number(match[3]), message: `${match[1]}: ${message}`})
      continue
    }
    // node:test failures: `not ok N - name` with a YAML block holding `location: 'path:line:col'` and `error: '...'`
    match = /^\s*not ok \d+ - (.+)$/u.exec(line)
    if (match) {
      const block = lines.slice(index + 1, index + 40)
      const end = block.findIndex(next => /^\s*(?:not )?ok \d+ /u.test(next))
      const body = end >= 0 ? block.slice(0, end) : block
      const location = body.map(next => /location: '(.+?):(\d+):\d+'/u.exec(next)).find(Boolean)
      const error = body.map(next => /^\s+error: [|>]?-?(.*)$/u.exec(next)?.[1]).find(text => text !== undefined)
      const errorText =
        (error === undefined ? undefined : unquoted(error.trimStart())) ||
        body.find((next, at) => at > 0 && /^\s+error:/u.test(body[at - 1] ?? ''))?.trim() ||
        'failed'
      if (location && !/^\s*#/u.test(match[1]!)) {
        push(problems, seen, {
          file: normalizePath(location[1]!, root),
          line: Number(location[2]),
          message: `${match[1]}: ${errorText}`,
        })
        continue
      }
    }
    // node:test spec reporter's summary: `test at path:line:col`, `✖ name (12ms)`, the error, then its stack, whose
    // first frame outside Node is where the assertion failed.
    match = /^test at (.+?):(\d+):\d+$/u.exec(line)
    if (match && /^✖ /u.test(lines[index + 1] ?? '')) {
      const name = lines[index + 1]!.replace(/^✖ /u, '').replace(/ \([\d.]+m?s\)$/u, '')
      const block = lines.slice(index + 2, index + 60)
      const end = block.findIndex(next => /^test at /u.test(next) || /^ℹ /u.test(next))
      const body = end >= 0 ? block.slice(0, end) : block
      const error =
        body
          .find(next => next.trim() && !/^\s+at /u.test(next))
          ?.trim()
          .replace(/^\w*Error \[\w+\]: /u, '') ?? 'failed'
      const frame = body.map(next => (/^\s+at /u.test(next) ? /(?:file:\/\/)?(\/[^():]+):(\d+):\d+\)?$/u.exec(next) : null)).find(Boolean)
      push(problems, seen, {
        file: frame ? normalizePath(frame[1]!, root) : normalizePath(match[1]!, root, directory),
        line: Number(frame ? frame[2] : match[2]),
        message: `${name}: ${error}`,
      })
      continue
    }
    // ESLint stylish: a path line, then `  12:5  error  message  rule`
    if (/^\/.+\.[cm]?[jt]sx?$/u.test(line) || /^[\w@.-]+(?:\/[\w@.-]+)+\.[cm]?[jt]sx?$/u.test(line)) {
      eslintFile = normalizePath(line, root, directory)
      continue
    }
    const stylish = eslintFile && stylishError(line)
    if (stylish) {
      push(problems, seen, {file: eslintFile, line: stylish.line, message: `${stylish.message} (${stylish.rule})`})
      continue
    }
    // check-boundaries and similar: path:line: message, or path: message
    match = /^([\w@.-]+(?:\/[\w@.-]+)+\.\w+):(\d+): (.+)$/u.exec(line)
    if (match) {
      push(problems, seen, {file: normalizePath(match[1]!, root, directory), line: Number(match[2]), message: match[3]!})
      continue
    }
    match = /^([\w@.-]+(?:\/[\w@.-]+)+\.\w+): (.+)$/u.exec(line)
    if (match && !/^https?:/u.test(line)) {
      push(problems, seen, {file: normalizePath(match[1]!, root, directory), line: undefined, message: match[2]!})
      continue
    }
  }
  return problems
}

/** oxfmt --check lists unformatted files, one per line (with or without a leading marker). */
export function parseFormatCheck(output: string, root: string): Problem[] {
  const problems: Problem[] = []
  for (const raw of output.replace(ansi, '').split('\n')) {
    const line = raw.trim().replace(/^[✗×x!-]\s+/u, '')
    if (/^[\w@.-]+(?:\/[\w@.-]+)*\.\w+(?: \(\d+ms\))?$/u.test(line) && !/^Finished|^Checking/u.test(line)) {
      problems.push({file: normalizePath(line.replace(/ \(\d+ms\)$/u, ''), root), line: undefined, message: 'not formatted (oxfmt)'})
    }
  }
  return problems
}

/** Considered's `check --json` report: one problem per violation (variances and warnings don't fail). */
export function parseConsidered(output: string): Problem[] {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end < start) return []
  let report: {violations?: {subject: string; metric: string; actual: number; standard: {max?: number; min?: number}}[]}
  try {
    report = JSON.parse(output.slice(start, end + 1))
  } catch {
    return []
  }
  return (report.violations ?? []).map(violation => ({
    file: violation.subject,
    line: undefined,
    message:
      violation.standard.max === undefined
        ? `${violation.metric} is ${violation.actual}, under the minimum of ${violation.standard.min}`
        : `${violation.metric} is ${violation.actual}, over the maximum of ${violation.standard.max}`,
  }))
}

/** The reference docs check lists stale pages indented under a heading. */
export function parseStalePages(output: string): Problem[] {
  const start = output.indexOf('Generated reference pages are stale:')
  if (start < 0) return []
  return output
    .slice(start)
    .split('\n')
    .slice(1)
    .filter(line => /^ {2}\S/u.test(line))
    .map(line => ({
      file: line.trim().replace(/ \(no longer generated\)$/u, ''),
      line: 1,
      message: line.includes('no longer generated') ? 'no longer generated' : 'stale',
    }))
}

/** The last `count` non-empty lines, for failures nothing could be parsed from. */
export function tail(output: string, count = 12): string[] {
  return output
    .replace(ansi, '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim())
    .slice(-count)
    .map(line => (line.length > 240 ? `${line.slice(0, 239)}…` : line))
}
