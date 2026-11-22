// Self topology, part of extract.mjs: each file's unit, language and role, and its source lines without comments.
import path from 'node:path'
import {join, prefixOf} from './units.mjs'

/** A file's language, by its name, or a shell script's by its `#!` line; null for anything else. */
export function languageOf(file, read) {
  if (/\.rs$/u.test(file)) return 'rust'
  if (/\.(?:m|c)?[jt]sx?$/u.test(file)) return 'javascript'
  if (/\.go$/u.test(file)) return 'go'
  if (/\.py$/u.test(file)) return 'python'
  if (/\.java$/u.test(file)) return 'java'
  if (/\.cs$/u.test(file)) return 'csharp'
  if (/\.css$/u.test(file)) return 'css'
  if (/(?:^|\/)[^./]+$/u.test(file) && /^#!.*\b(?:ba|z)?sh\b/u.test(read(file).slice(0, 64))) return 'shell'
  return null
}

/** Adds the scripts that are units of their own, then assigns every source file to its unit with its role. */
export function assignSources({units, addUnit, roots, files, read}) {
  // Shell scripts at a root, or each in a directory named after it outside every other unit (`tools/gh-projections/
  // gh-projections`), are units of their own, named by the root and their name, so moving one keeps its ID.
  const insideUnit = file => [...units.values()].some(unit => file.startsWith(`${unit.directory}/`))
  for (const root of roots) {
    for (const file of files) {
      const directory = path.posix.dirname(file)
      const own =
        directory === (root.path || '.') ||
        (file.startsWith(prefixOf(root.path)) && path.posix.basename(directory) === path.posix.basename(file))
      if (own && !insideUnit(file) && languageOf(file, read) === 'shell') {
        addUnit({
          id: `script:${join(root.path, path.posix.basename(file))}`,
          kind: 'script',
          label: path.posix.basename(file),
          root: root.path,
          directory: file,
          single: file,
          language: 'shell',
          scan: root.capabilities !== false,
          data: {area: root.area ?? (root.path || '.'), path: file},
        })
      }
    }
  }

  const unitsByDirectory = new Map()
  for (const unit of units.values()) {
    if (unit.single) continue
    const list = unitsByDirectory.get(unit.directory) ?? []
    list.push(unit)
    unitsByDirectory.set(unit.directory, list)
  }

  function ownerOf(file, language) {
    let directory = path.posix.dirname(file)
    while (directory && directory !== '.') {
      const candidates = unitsByDirectory.get(directory)
      if (candidates) {
        const same = candidates.find(unit => unit.language === language)
        if (same) return same
        const other = candidates.find(unit => unit.kind !== 'helper')
        if (other) return other
      }
      directory = path.posix.dirname(directory)
    }
    return null
  }

  const testSegments = new Set([
    'test',
    'tests',
    '__tests__',
    'fixtures',
    'testdata',
    'benches',
    'browser',
    'playwright',
    'e2e',
    'stories',
    'examples',
  ])
  function roleOf(relative) {
    const segments = relative.split('/')
    const name = segments.at(-1)
    if (name === 'build.rs') return 'build'
    if (segments.some(segment => testSegments.has(segment))) return 'test'
    if (/\.(?:test|spec|stories|bench)\.[^.]+$/u.test(name) || /(?:^|_)tests?\.rs$/u.test(name)) return 'test'
    if (segments.slice(0, -1).some(segment => segment === 'scripts' || segment === 'build')) return 'build'
    if (/\.config\.[cm]?[jt]s$/u.test(name)) return 'build'
    return 'source'
  }

  const unitFiles = new Map([...units.keys()].map(id => [id, []]))
  const singles = new Map([...units.values()].filter(unit => unit.single).map(unit => [unit.single, unit]))
  for (const file of files) {
    const language = languageOf(file, read)
    if (!language || /(?:^|\/)(?:node_modules|dist|target|\.data)(?:\/|$)/u.test(file)) continue
    const owner = singles.get(file) ?? ownerOf(file, language)
    if (!owner) continue
    const relative = owner.single ? path.posix.basename(file) : file.slice(owner.directory.length + 1)
    unitFiles.get(owner.id).push({file, relative, language, role: roleOf(relative)})
  }
  return unitFiles
}

// Source lines without comments, and Rust without its inline `#[cfg(test)] mod`s.

export function stripComments(text, language) {
  let result = text
  if (['rust', 'javascript', 'go', 'java', 'csharp', 'css'].includes(language)) {
    result = result.replace(/\/\*[\s\S]*?\*\//gu, block => block.replace(/[^\n]/gu, ' '))
  }
  if (language === 'css') return result.split('\n')
  const comment = language === 'python' || language === 'shell' ? /^\s*#(?!!).*$/u : /(^|[\s;,{}()])\/\/.*$/u
  return result.split('\n').map(line => line.replace(comment, (_, lead = '') => lead))
}

export function withoutRustTests(lines) {
  const kept = [...lines]
  for (let index = 0; index < kept.length; index += 1) {
    if (!/^\s*#\[cfg\(test\)\]\s*$/u.test(kept[index])) continue
    let cursor = index + 1
    while (cursor < kept.length && /^\s*(?:#\[.*)?$/u.test(kept[cursor])) cursor += 1
    if (cursor >= kept.length || !/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/u.test(kept[cursor])) continue
    let depth = 0
    let end = cursor
    for (; end < kept.length; end += 1) {
      for (const character of kept[end].replace(/"(\\.|[^"\\])*"|'(\\.|[^'\\])'/gu, '')) {
        if (character === '{') depth += 1
        else if (character === '}') depth -= 1
      }
      if (depth <= 0) break
    }
    for (let line = index; line <= Math.min(end, kept.length - 1); line += 1) kept[line] = ''
    index = end
  }
  return kept
}

/** A reader of a file entry's source lines, without comments (and Rust without its tests), each file once. */
export function lineReader(read) {
  const fileLines = new Map()
  return function linesOf(entry) {
    if (!fileLines.has(entry.file)) {
      let lines = stripComments(read(entry.file), entry.language)
      if (entry.language === 'rust') lines = withoutRustTests(lines)
      fileLines.set(entry.file, lines)
    }
    return fileLines.get(entry.file)
  }
}
