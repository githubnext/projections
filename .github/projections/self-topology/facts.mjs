// Self topology's facts about each unit, beyond its connections: what it is for, how big it is and in which languages,
// how much of it is tests, how it is assured (proved, mutation tested, coverage gated, property tested),
// where it ships (see `releases.mjs`), and where it runs. Every fact is read from the revision's files; nothing is generated.
//
// Size is counted in tokens: identifiers, keywords, numbers and strings, without comments or punctuation. Unlike lines,
// it doesn't move when a formatter rewraps code or adds and removes commas, braces and semicolons. Sizes are rounded to
// steps about a fifth apart and language shares to tens of percent, so an ordinary edit doesn't make a unit modified,
// while a real change of size or language mix does.

import path from 'node:path'
import {actionScripts, channelWords} from './releases.mjs'

/** Linguist's name for a source file's language, or undefined for a file that isn't counted. */
export function linguistOf(file, language) {
  if (language === 'shell') return 'Shell'
  if (/\.rs$/.test(file)) return 'Rust'
  if (/\.(m|c)?tsx?$/.test(file)) return 'TypeScript'
  if (/\.(m|c)?jsx?$/.test(file)) return 'JavaScript'
  if (/\.go$/.test(file)) return 'Go'
  if (/\.py$/.test(file)) return 'Python'
  if (/\.java$/.test(file)) return 'Java'
  if (/\.cs$/.test(file)) return 'C#'
  if (/\.css$/.test(file)) return 'CSS'
  return undefined
}

/** Round sizes: steps about a fifth apart in every decade, so a size moves only when it grows or shrinks by that. */
const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/** A size on the round steps, nearest in proportion: 12,437 tokens read 12,000, 437 read 400 and 47,000 read 50,000. */
export function rounded(count) {
  if (!(count > 0)) return 0
  const decade = 10 ** Math.floor(Math.log10(count))
  const ratio = count / decade
  const step = steps.reduce((best, value) => (Math.abs(Math.log(value / ratio)) < Math.abs(Math.log(best / ratio)) ? value : best))
  return Math.round(step * decade)
}

// Files that are data for tests or third-party code, counted as neither source nor tests.
const notCounted = /(^|\/)(fixtures|testdata|examples|vendor|generated|snapshots)(\/|$)|\.d\.ts$|\.min\.js$/

/** A YAML front matter field, unquoted (a plain, quoted or folded scalar on one or more lines). */
export function frontMatterField(text, field) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return undefined
  const lines = match[1].split(/\r?\n/)
  const start = lines.findIndex(line => line.startsWith(`${field}:`))
  if (start < 0) return undefined
  let value = lines[start].slice(field.length + 1).trim()
  if (/^[>|][-+]?$/.test(value) || value === '') {
    const block = []
    for (const line of lines.slice(start + 1)) {
      if (!/^\s+\S/.test(line)) break
      block.push(line.trim())
    }
    value = block.join(' ')
  }
  if (/^".*"$/.test(value)) value = JSON.parse(value)
  else if (/^'.*'$/.test(value)) value = value.slice(1, -1).replaceAll("''", "'")
  return value.trim() || undefined
}

/** The YAML front matter's `description`: what its component is for. */
export const frontMatterDescription = text => frontMatterField(text, 'description')

/**
 * The YAML front matter's `icon`: the name of the icon its component's card shows (a Lucide name the graph renderer
 * draws, such as `terminal`; the renderer ignores, and warns of, any other).
 */
export const frontMatterIcon = text => frontMatterField(text, 'icon')

/** A README's first prose paragraph's first sentence, without Markdown links, code marks or emphasis. */
export function firstSentence(text) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  const paragraph = body
    .split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .find(block => block && !/^(#|<|!\[|```|\||- |\* |\d+\. |>)/.test(block))
  if (!paragraph) return undefined
  const plain = paragraph
    .replace(/\s+/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
  const sentence = /^(.*?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain
  return sentence.trim() || undefined
}

/** `cargo llvm-cov … -p <crate> … --fail-under-lines <n>` commands in package scripts and workflows: crate → percent. */
function coverageGates(texts) {
  const gates = new Map()
  for (const text of texts)
    for (const command of text.match(/cargo llvm-cov[^\n"]*/g) ?? []) {
      const floor = /--fail-under-lines[ =](\d+(\.\d+)?)/.exec(command)?.[1]
      if (!floor) continue
      for (const [, name] of command.matchAll(/(?:^|\s)(?:-p|--package)[ =]([\w-]+)/g))
        gates.set(name, Math.max(gates.get(name) ?? 0, Number(floor)))
    }
  return gates
}

/** The directories `cargo mutants` examines, from `.cargo/mutants.toml`'s `examine_globs` (the part before a glob). */
function mutantDirectories(text) {
  const list = /examine_globs\s*=\s*\[([^\]]*)\]/.exec(text)?.[1] ?? ''
  return [...list.matchAll(/["']([^"']+)["']/g)].map(([, glob]) =>
    glob
      .split(/[*?[{]/)[0]
      .replace(/\/(src\/?)?$/, '')
      .replace(/\/$/, ''),
  )
}

/**
 * Tokens in lines of code without comments: words, numbers and quoted strings, each one. A Rust `'` quotes one
 * character (`'a` alone is a lifetime, a word).
 */
const quoted = /"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|\d[\w.]*/
const tokenPatterns = {
  rust: new RegExp(`'(?:\\\\.|[^'\\\\])'|${quoted.source}`, 'g'),
  other: new RegExp(`'(?:\\\\.|[^'\\\\\\n])*'|${quoted.source}`, 'g'),
}
export const tokens = (lines, language) =>
  lines.reduce((count, line) => count + (line.match(tokenPatterns[language === 'rust' ? 'rust' : 'other'])?.length ?? 0), 0)

/** How a unit's Verus proofs read: `64 functions proved by Verus`. */
export const provedWords = count => `${count} ${count === 1 ? 'function' : 'functions'} proved by Verus`
/** How a unit that depends on proved code reads. */
export const usesProved = 'uses Verus-proved code'

const propertyTests = /\bproptest!|\bproptest::|\bquickcheck\b|from\s+['"]fast-check['"]|\bfc\.(assert|property)\(/
const verusBlock = /\bverus!\s*\{/

/** Functions with a Verus specification: `requires` or `ensures` between their name and their body. */
const provedFunctions = text => text.match(/\bfn\s+\w+[^{;]*?\b(requires|ensures)\b/g)?.length ?? 0

/**
 * Each unit's facts, keyed by unit ID. `context` is the extractor's: its units, their files with roles, the comment
 * stripper, the revision's file reader and list, its roots and its relationships (for where a unit runs).
 */
export function unitFacts(context) {
  const {units, unitFiles, read, files, roots, relationships, stripComments} = context
  const texts = [
    ...roots.map(root => `${root.path ? `${root.path}/` : ''}package.json`),
    ...files.filter(file => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(file)),
  ].map(read)
  const gates = coverageGates(texts)
  const mutants = roots.flatMap(root =>
    mutantDirectories(read(`${root.path ? `${root.path}/` : ''}.cargo/mutants.toml`)).map(directory =>
      root.path ? `${root.path}/${directory}` : directory,
    ),
  )

  const facts = new Map()
  for (const unit of units.values()) {
    const shares = new Map()
    let code = 0,
      tests = 0,
      proofs = 0,
      properties = false
    for (const entry of unitFiles.get(unit.id) ?? []) {
      const name = linguistOf(entry.file, entry.language)
      if (!name || entry.role === 'build' || notCounted.test(entry.relative)) continue
      const text = read(entry.file)
      const stripped = stripComments(text, entry.language)
      const all = tokens(stripped, entry.language)
      if (entry.role === 'test') {
        tests += all
        if (propertyTests.test(text)) properties = true
        continue
      }
      // A Rust file's inline `#[cfg(test)] mod` is tests; the rest is source.
      const source = entry.language === 'rust' ? tokens(context.withoutRustTests(stripped), 'rust') : all
      tests += all - source
      code += source
      shares.set(name, (shares.get(name) ?? 0) + source)
      if (entry.language === 'rust' && all > source && propertyTests.test(text)) properties = true
      // Verus: each function a `verus!` block specifies (`requires` or `ensures` before its body) is proved for every input.
      if (entry.language === 'rust' && verusBlock.test(text)) proofs += provedFunctions(stripped.join('\n'))
    }
    const languages = [...shares]
      .map(([name, count]) => [name, code ? Math.round((count / code) * 10) * 10 : 0])
      .filter(([, share]) => share >= 10)
      .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    const assurance = []
    if (unit.kind === 'rust-crate' && mutants.some(directory => directory === unit.directory)) assurance.push('mutation tested')
    const gate = unit.kind === 'rust-crate' ? gates.get(unit.data.package) : undefined
    if (gate) assurance.push(`${gate}% coverage gate`)
    if (properties) assurance.push('property tests')
    const published = (unit.meta?.published ?? []).map(channelWords)
    facts.set(unit.id, {
      ...describe(unit, context),
      ...(code || tests ? {tokens: rounded(code), testTokens: rounded(tests)} : {}),
      ...(languages.length ? {language: languages[0][0], languages: languages.map(([name, share]) => `${name} ${share}%`)} : {}),
      ...(proofs ? {provedFunctions: proofs} : {}),
      ...(gate ? {coverageGate: gate} : {}),
      // Formal verification is its own fact, the strongest assurance; the rest are how it is tested, and where it ships.
      verification: proofs ? [provedWords(proofs)] : [],
      traits: [...assurance, ...published],
    })
  }
  // A unit that depends on proved code runs it: the proofs cover its decisions too.
  for (const {kind, from, to} of relationships.values())
    if (kind === 'depends-on' && facts.get(to)?.provedFunctions && !facts.get(from).verification.length)
      facts.get(from).verification.push(usesProved)
  const runs = whereUnitsRun(context)
  for (const [id, places] of runs) if (places.size) facts.get(id).runs = [...places].sort()
  return facts
}

/** What a unit is for, and the icon its README's front matter names for it. */
function describe(unit, context) {
  const readme = unit.single ? undefined : `${unit.directory.replace(/#.*$/, '')}/README.md`
  const text = readme && context.fileSet.has(readme) ? context.read(readme) : ''
  const icon = unit.kind !== 'wasm-module' && frontMatterIcon(text)
  return {...purpose(unit, context, readme, text), ...(icon ? {icon} : {})}
}

/** What a unit is for: its README's front matter, its manifest's description, else its README's first sentence. */
function purpose(unit, {units, unitFiles}, readme, text) {
  const fromFrontMatter = unit.kind !== 'wasm-module' && frontMatterDescription(text)
  if (fromFrontMatter) return {description: fromFrontMatter, descriptionSource: readme}
  if (unit.meta?.description) return {description: unit.meta.description, descriptionSource: unit.manifest}
  const sentence = unit.kind !== 'wasm-module' && unit.kind !== 'helper' && firstSentence(text)
  if (sentence) return {description: sentence, descriptionSource: readme}
  // Units with no words of their own are described by what they are, which the extractor knows.
  if (unit.kind === 'wasm-module') {
    const crate = [...units.values()].find(other => other.kind === 'rust-crate' && other.data.package === unit.data.crate)
    return {description: `${path.posix.basename(crate?.directory ?? unit.data.crate)} compiled to WebAssembly`}
  }
  if (unit.kind === 'helper') {
    const parent = [...units.values()].find(other => other.kind === 'rust-crate' && unit.directory.startsWith(`${other.directory}/`))
    const language = linguistOf(unitFiles.get(unit.id)?.[0]?.file ?? '', unit.language) ?? unit.language
    return {description: `The ${language} helper process${parent ? ` ${path.posix.basename(parent.directory)} runs` : ''}`}
  }
  if (unit.kind === 'script') return {description: `A shell script: ${path.posix.basename(unit.directory)}`}
  return {}
}

/**
 * Where each unit runs: its own entry points (a Rust binary is a command line, `cli`; an extension declaring
 * `engines.vscode` runs in `vscode`; a package using the DOM or React in a `browser`; one using Node's filesystem or processes in
 * `node`; a WebAssembly module, and a crate compiled to one, in `wasm`; a package the repository's action runs in `ci`),
 * and everywhere a unit that depends on or loads it runs.
 */
function whereUnitsRun({units, relationships, read, roots}) {
  const places = new Map([...units.keys()].map(id => [id, new Set()]))
  const actionMains = roots.flatMap(root => {
    const prefix = root.path ? `${root.path}/` : ''
    return actionScripts(read(`${prefix}action.yml`)).map(({script}) => `${prefix}${script}`)
  })
  for (const unit of units.values()) {
    const own = places.get(unit.id)
    const capabilities = Object.keys(unit.capabilityFiles)
    if (unit.kind === 'rust-crate' && unit.data.targets.includes('bin')) own.add('cli')
    if (unit.kind === 'wasm-module') own.add('wasm')
    if (unit.meta?.vscode) own.add('vscode')
    else if (unit.language === 'javascript' && (capabilities.includes('dom') || unit.meta?.react)) own.add('browser')
    else if (unit.language === 'javascript' && (capabilities.includes('fs') || capabilities.includes('process'))) own.add('node')
    if (actionMains.some(file => file.startsWith(`${unit.directory}/`))) own.add('ci')
  }
  // A crate compiled to WebAssembly runs as that module; the module, not the crate, runs where it's loaded.
  for (const relationship of relationships.values()) if (relationship.kind === 'compiles-to') places.get(relationship.from).add('wasm')
  // Downstream: what a unit links or loads runs where it runs. What a build bundles is shipped there, but may run
  // elsewhere (an extension bundles the CLI it spawns), so it carries nothing.
  const carries = ['depends-on', 'loads']
  const edges = [...relationships.values()].filter(relationship => carries.includes(relationship.kind))
  for (let changed = true; changed;) {
    changed = false
    for (const {from, to} of edges)
      for (const place of places.get(from))
        if (!places.get(to).has(place)) {
          places.get(to).add(place)
          changed = true
        }
  }
  return places
}
