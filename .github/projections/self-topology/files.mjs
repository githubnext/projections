// Self topology, part of extract.mjs: the project's files, listed the way Git does, and read once each.
import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import path from 'node:path'

export const posix = value => value.split(path.sep).join('/')
export const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
export const sortedUnique = values => [...new Set(values)].toSorted(byText)

// Files, listed the way Git does (tracked and untracked nonignored), or walked outside a work tree.
export function listFiles(repo) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: repo,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return sortedUnique(out.toString('utf8').split('\0').filter(Boolean)).filter(file => existsSync(path.join(repo, file)))
  } catch {
    const found = []
    const skip = new Set(['.git', 'node_modules', 'target', 'dist', '.data'])
    const walk = relative => {
      for (const entry of readdirSync(path.join(repo, relative), {withFileTypes: true})) {
        if (skip.has(entry.name)) continue
        const child = relative ? `${relative}/${entry.name}` : entry.name
        if (entry.isDirectory()) walk(child)
        else if (entry.isFile()) found.push(child)
      }
    }
    walk('')
    return found.toSorted(byText)
  }
}

/** A reader of the project's files: each file's text once, empty when it is too large or can't be read. */
export function reader(repo) {
  const sourceCache = new Map()
  return function read(file) {
    if (!sourceCache.has(file)) {
      let text = ''
      try {
        if (statSync(path.join(repo, file)).size <= 2 * 1024 * 1024) text = readFileSync(path.join(repo, file), 'utf8')
      } catch {
        // A file that can't be read (removed while listing, unreadable) has no source to count, like a binary one.
      }
      sourceCache.set(file, text)
    }
    return sourceCache.get(file)
  }
}
