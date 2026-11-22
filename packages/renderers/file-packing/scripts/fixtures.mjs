#!/usr/bin/env node
// Writes this package's scenario fixtures as repository-map extractions (graph/v0: directory and file
// entities joined by `contains`, files with their blob `size` and `lines`), shaped exactly like what
// `projections show -p repository-map` produces with `inputs.lines: true`:
//
//   node scripts/fixtures.mjs opensource <before-rev> <after-rev>   this repository's own tree
//   node scripts/fixtures.mjs refresh <rev>                          the opensource fixtures' stale paths, from <rev>
//   node scripts/fixtures.mjs sample                                 a small sample repository
//   node scripts/fixtures.mjs settings                               a synthetic settings map (treemap/v0, kinds and flags)
//
// Revisions are read from Git objects only (never the working tree), so a fixture is reproducible.
import {execFileSync} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', 'fixtures')

function parentOf(path) {
  const index = path.lastIndexOf('/')
  return index < 0 ? '.' : path.slice(0, index)
}
const basename = path => path.slice(path.lastIndexOf('/') + 1)

function lineCount(bytes) {
  if (bytes.subarray(0, 8000).includes(0)) return undefined
  let lines = 0
  for (const byte of bytes) if (byte === 10) lines++
  return lines + (bytes.length && bytes.at(-1) !== 10 ? 1 : 0)
}

/** A repository-map extraction of `files` ({path, size, lines?}), in the extractor's order. */
function extraction(files) {
  const entities = [{id: 'directory:.', kind: 'directory', label: '.'}]
  const relationships = []
  const directories = new Set(['.'])
  const addDirectory = directory => {
    if (directories.has(directory)) return
    const parent = parentOf(directory)
    addDirectory(parent)
    directories.add(directory)
    entities.push({id: `directory:${directory}`, kind: 'directory', label: basename(directory), data: {path: directory}})
    relationships.push({id: `contains:directory:${directory}`, kind: 'contains', from: `directory:${parent}`, to: `directory:${directory}`})
  }
  for (const file of [...files].toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const parent = parentOf(file.path)
    addDirectory(parent)
    entities.push({
      id: `file:${file.path}`,
      kind: 'file',
      label: basename(file.path),
      data: {path: file.path, size: file.size, ...(file.lines === undefined ? {} : {lines: file.lines})},
    })
    relationships.push({id: `contains:file:${file.path}`, kind: 'contains', from: `directory:${parent}`, to: `file:${file.path}`})
  }
  return {protocolVersion: 0, schema: 'graph/v0', entities, relationships}
}

/** One item per line: readable diffs, without the size of full indentation. */
function write(name, document) {
  const lines = (items, key) => `  "${key}": [\n${items.map(item => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]`
  const text = `{\n  "protocolVersion": 0,\n  "schema": "${document.schema}",\n${lines(document.entities, 'entities')},\n${lines(document.relationships, 'relationships')}\n}\n`
  writeFileSync(join(fixtures, name), text)
}

/** The files under `prefix` at a Git revision, with sizes and line counts from their blobs. */
function revisionFiles(revision, prefix) {
  const git = (args, input) => execFileSync('git', args, {input, maxBuffer: 512 * 1024 * 1024})
  const tree = git(['ls-tree', '-r', '-z', '--full-tree', revision, ...(prefix ? ['--', prefix] : [])]).toString('utf8')
  const entries = tree
    .split('\0')
    .filter(Boolean)
    .map(line => {
      const [record, path] = line.split('\t')
      const [mode, type, object] = record.split(' ')
      return {mode, type, object, path: path.slice(prefix.length)}
    })
    .filter(entry => entry.type === 'blob' && ['100644', '100755', '120000'].includes(entry.mode))
  const output = git(['cat-file', '--batch'], `${entries.map(entry => entry.object).join('\n')}\n`)
  let cursor = 0
  return entries.map(entry => {
    const end = output.indexOf(10, cursor)
    const size = Number(output.subarray(cursor, end).toString('utf8').split(' ')[2])
    const bytes = output.subarray(end + 1, end + 1 + size)
    cursor = end + 1 + size + 1
    return {path: entry.path, size, ...(entry.mode === '120000' ? {} : {lines: lineCount(bytes)})}
  })
}

const topLevel = path => path.slice(0, path.indexOf('/') + 1)

/**
 * Keeps the opensource fixtures' scale and their change, but not paths the repository no longer has: every file
 * both fixtures list that `current` lacks becomes an unlisted current file (from the same top-level directory when
 * one is left), with its current size, in both. Paths only one side lists are the change itself and stay.
 */
function refresh(current) {
  const read = name =>
    JSON.parse(readFileSync(join(fixtures, name), 'utf8'))
      .entities.filter(entity => entity.kind === 'file')
      .map(entity => ({path: entity.data.path, size: entity.data.size, lines: entity.data.lines}))
  const before = read('opensource-before.json')
  const after = read('opensource-after.json')
  const byPath = new Map(current.map(file => [file.path, file]))
  const listed = new Set([...before, ...after].map(file => file.path))
  const inAfter = new Set(after.map(file => file.path))
  const stale = before.filter(file => inAfter.has(file.path) && !byPath.has(file.path)).map(file => file.path)
  const unused = current.filter(file => !listed.has(file.path)).map(file => file.path)
  const taken = new Set()
  const replacement = new Map()
  for (const path of stale.toSorted()) {
    const pick = unused.find(other => !taken.has(other) && topLevel(other) === topLevel(path)) ?? unused.find(other => !taken.has(other))
    if (!pick) break
    taken.add(pick)
    replacement.set(path, byPath.get(pick))
  }
  const refreshed = files =>
    files.flatMap(file => (stale.includes(file.path) ? (replacement.has(file.path) ? [replacement.get(file.path)] : []) : [file]))
  write('opensource-before.json', extraction(refreshed(before)))
  write('opensource-after.json', extraction(refreshed(after)))
  console.log(`Replaced ${replacement.size} of ${stale.length} stale paths`)
}

/** A small web application: a search feature arrives, a vendored dependency leaves, the API client grows. */
function sample() {
  const before = [
    ['README.md', 2140, 61],
    ['package.json', 812, 34],
    ['package-lock.json', 21480, 640],
    ['src/main.ts', 640, 22],
    ['src/app.tsx', 3880, 121],
    ['src/routes.ts', 1210, 41],
    ['src/api/client.ts', 2410, 77],
    ['src/api/types.ts', 1780, 66],
    ['src/components/Button.tsx', 1320, 48],
    ['src/components/Header.tsx', 2290, 75],
    ['src/components/TodoList.tsx', 4630, 152],
    ['src/components/TodoItem.tsx', 2050, 70],
    ['src/styles/app.css', 3410, 160],
    ['src/styles/theme.css', 1290, 58],
    ['src/vendor/moment.js', 17890, 512],
    ['test/app.test.tsx', 2980, 93],
    ['test/client.test.ts', 1650, 55],
    ['docs/setup.md', 1880, 52],
    ['public/logo.svg', 4210, 12],
    ['public/favicon.png', 6520, undefined],
  ]
  const after = [
    ['README.md', 2480, 70],
    ['package.json', 845, 35],
    ['package-lock.json', 20950, 622],
    ['src/main.ts', 640, 22],
    ['src/app.tsx', 4120, 130],
    ['src/routes.ts', 1490, 50],
    ['src/api/client.ts', 4930, 158],
    ['src/api/types.ts', 1780, 66],
    ['src/components/Button.tsx', 1320, 48],
    ['src/components/Header.tsx', 2290, 75],
    ['src/components/TodoList.tsx', 3010, 99],
    ['src/components/TodoItem.tsx', 2050, 70],
    ['src/components/Filters.tsx', 2760, 91],
    ['src/search/index.ts', 3120, 104],
    ['src/search/rank.ts', 1940, 63],
    ['src/styles/app.css', 3650, 171],
    ['src/styles/theme.css', 1290, 58],
    ['test/app.test.tsx', 2980, 93],
    ['test/client.test.ts', 2730, 90],
    ['test/search.test.ts', 2210, 74],
    ['docs/setup.md', 1880, 52],
    ['docs/search.md', 1460, 39],
    ['public/logo.svg', 4210, 12],
    ['public/favicon.png', 6520, undefined],
  ]
  const files = list => list.map(([path, size, lines]) => ({path, size, ...(lines === undefined ? {} : {lines})}))
  write('sample-before.json', extraction(files(before)))
  write('sample-after.json', extraction(files(after)))
}

/** The workspace's path prefix in the Git repository it is read from, after moving to that repository's root. */
function workspacePrefix() {
  // The workspace root, which may be nested in the Git repository it is read from.
  const workspace = fileURLToPath(new URL('../../../../', import.meta.url))
  const git = (...command) =>
    execFileSync('git', ['-C', workspace, ...command])
      .toString()
      .trim()
  const prefix = git('rev-parse', '--show-prefix')
  process.chdir(git('rev-parse', '--show-toplevel'))
  return prefix
}

/**
 * A synthetic settings map (treemap/v0): one equal circle per settings key, nested under its owner (server, client,
 * and providers › each provider). A key's kind is its main classification (setting, hidden, secret, pre-release, not
 * patchable); `data.flags` lists every attribute it has, so a key can carry more than one. The after revision adds a
 * secret key to one provider, removes a pre-release key and makes a hidden key a plain setting.
 */
function settings() {
  const words = ['mode', 'path', 'limit', 'timeout', 'retries', 'theme', 'locale', 'cache', 'port', 'host', 'level', 'format']
  const groups = [
    ['server', 44],
    ['client', 38],
    ['providers/atlas', 6],
    ['providers/borealis', 5],
    ['providers/cirrus', 4],
    ['providers/longProviderName', 5],
    ['providers/delta', 3],
    ['providers/ember', 4],
    ['providers/fjord', 3],
    ['providers/glacier', 5],
    ['providers/harbor', 3],
  ]
  // A key's attributes by its index in its group: deterministic, and varied across groups.
  const attributes = (group, index) => {
    const provider = group.startsWith('providers/')
    if (provider && index === 1) return ['hidden']
    if (provider && index === 2 && group.length % 2) return ['secret', 'hidden']
    if (provider && index === 3) return ['hidden', 'not-patchable']
    if (!provider && index % 11 === 4) return ['pre-release']
    if (!provider && index % 13 === 7) return ['not-patchable']
    if (!provider && index % 17 === 9) return ['hidden', 'pre-release']
    if (!provider && index === 20) return ['secret', 'not-patchable', 'hidden']
    return []
  }
  const kindOf = flags => (flags.includes('secret') ? 'secret' : (flags[0] ?? 'setting'))
  const keys = []
  for (const [group, count] of groups) {
    for (let index = 0; index < count; index++) {
      const word = words[(index * 5 + group.length) % words.length]
      keys.push({group, index, name: index < words.length ? word : `${word}${index}`, flags: attributes(group, index)})
    }
  }
  const document = list => {
    const entities = [{id: 'settings', kind: 'group', label: 'settings'}]
    const relationships = []
    const seen = new Set()
    const group = path => {
      if (seen.has(path)) return `group:${path}`
      seen.add(path)
      const parent = path.includes('/') ? group(path.slice(0, path.lastIndexOf('/'))) : 'settings'
      entities.push({id: `group:${path}`, kind: 'group', label: basename(path)})
      relationships.push({id: `contains:group:${path}`, kind: 'contains', from: parent, to: `group:${path}`})
      return `group:${path}`
    }
    for (const key of list) {
      const parent = group(key.group)
      const id = `setting:${key.group.replaceAll('/', '.')}.${key.name}`
      entities.push({
        id,
        kind: kindOf(key.flags),
        label: key.name,
        data: {value: 1, ...(key.flags.length > 1 ? {flags: key.flags} : {})},
      })
      relationships.push({id: `contains:${id}`, kind: 'contains', from: parent, to: id})
    }
    return {protocolVersion: 0, schema: 'treemap/v0', entities, relationships}
  }
  const after = keys
    .filter(key => !(key.group === 'server' && key.index === 4))
    .map(key => (key.group === 'client' && key.flags.join(',') === 'hidden,pre-release' ? {...key, flags: ['pre-release']} : key))
  after.push({group: 'providers/atlas', index: -1, name: 'credentialsFile', flags: ['secret', 'hidden']})
  write('settings-before.json', document(keys))
  write('settings-after.json', document(after))
}

const [command, ...args] = process.argv.slice(2)
if (command === 'sample') sample()
else if (command === 'settings') settings()
else if (command === 'opensource' && args.length === 2) {
  const prefix = workspacePrefix()
  write('opensource-before.json', extraction(revisionFiles(args[0], prefix)))
  write('opensource-after.json', extraction(revisionFiles(args[1], prefix)))
} else if (command === 'refresh' && args.length === 1) {
  refresh(revisionFiles(args[0], workspacePrefix()))
} else {
  console.error('Usage: node scripts/fixtures.mjs sample | settings | opensource <before-rev> <after-rev> | refresh <rev>')
  process.exit(2)
}
