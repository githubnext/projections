#!/usr/bin/env node
// Generates vendor/linguist/languages.js (and its LICENSE and vendor.json) from GitHub Linguist's languages.yml at a
// pinned release: every language's type, group and extensions and filenames, and for programming and markup
// languages their Linguist color, calibrated per theme to the Projector palette (see calibration.mjs).
//
//   node scripts/linguist.mjs                     fetches the pinned release from GitHub
//   node scripts/linguist.mjs --source <checkout>  reads lib/linguist/languages.yml and LICENSE from a local checkout
//   --profile softer|default|stronger              the calibration (default `default`; the others are for comparison)
//
// Build the SDK first (`npm run build -w @githubnext/projections-renderer-sdk`): the backgrounds are the token
// set's own defaults.
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {parse} from 'yaml'
import {contrast, distance} from './colors.mjs'
import {calibrate, minimumContrast as minimum, profileArgument, separate, separation} from './calibration.mjs'
import {defaultThemeTokens} from '../dist/tokens.js'

const release = 'v9.7.0'
const repository = 'https://github.com/github-linguist/linguist'
const output = new URL('../vendor/linguist/', import.meta.url)

const {name: profileName, profile} = profileArgument()

/**
 * Languages in order of how often they are found side by side in repositories. They win extension conflicts
 * (`.h` is C, `.md` is Markdown, `.rs` is Rust), and each keeps its color clear of the ones before it.
 */
const common = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Java',
  'C#',
  'C',
  'C++',
  'Go',
  'Rust',
  'Ruby',
  'PHP',
  'Kotlin',
  'Swift',
  'Shell',
  'HTML',
  'CSS',
  'SCSS',
  'Vue',
  'Svelte',
  'Astro',
  'Dart',
  'Scala',
  'Objective-C',
  'Elixir',
  'Haskell',
  'Lua',
  'R',
  'Julia',
  'PowerShell',
  'Perl',
  'Clojure',
  'F#',
  'Groovy',
  'Zig',
  'Nix',
  'HCL',
  'Dockerfile',
  'Makefile',
  'Jupyter Notebook',
  'Less',
  'Sass',
  'MDX',
  'Markdown',
  'JSON',
  'JSON with Comments',
  'YAML',
  'TOML',
  'XML',
  'SVG',
  'SQL',
  'GraphQL',
  'Protocol Buffer',
  'Text',
  'Batchfile',
  'CMake',
  'Elm',
  'OCaml',
  'Erlang',
  'Solidity',
  'MATLAB',
]

async function read(file) {
  const index = process.argv.indexOf('--source')
  if (index > 0) return readFileSync(join(process.argv[index + 1], file), 'utf8')
  const response = await fetch(`https://raw.githubusercontent.com/github-linguist/linguist/${release}/${file}`)
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`)
  return response.text()
}

const document = parse(await read('lib/linguist/languages.yml'))
const license = await read('LICENSE')
const rank = name => {
  const index = common.indexOf(name)
  return index < 0 ? common.length : index
}
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const names = Object.keys(document)
  .filter(name => document[name].extensions?.length || document[name].filenames?.length)
  .sort((a, b) => rank(a) - rank(b) || byName(a, b))

const backgrounds = {light: defaultThemeTokens('light')['color-bg'], dark: defaultThemeTokens('dark')['color-bg']}
const other = {light: defaultThemeTokens('light')['color-border-emphasis'], dark: defaultThemeTokens('dark')['color-border-emphasis']}
const colored = name => ['programming', 'markup'].includes(document[name].type) && document[name].color && !document[name].group
const placed = {light: [other.light], dark: [other.dark]}

const rows = names.map(name => {
  const entry = document[name]
  const row = [name, entry.type, entry.group ?? null]
  if (!colored(name)) return [...row, null, null, null]
  const original = entry.color.toLowerCase()
  const colors = {}
  for (const mode of ['light', 'dark']) {
    let color = calibrate(original, backgrounds[mode], profile[mode])
    if (rank(name) < common.length) {
      // The most common languages keep clearly apart from each other and from "other"; the rest a little less.
      const gap = rank(name) < separation.commonCount ? separation.wide : separation.narrow
      color = separate(color, placed[mode], backgrounds[mode], profile[mode], gap)
      if (rank(name) < separation.commonCount && placed[mode].some(other => distance(color, other) < gap)) {
        // Comparison profiles may not separate everything; the shipped one must.
        const message = `${name} ${mode} ${color} is too close to a more common language`
        if (profileName === 'default') throw new Error(message)
        console.warn(`warning: ${message}`)
      }
      placed[mode].push(color)
    }
    if (contrast(color, backgrounds[mode]) < minimum) throw new Error(`${name} ${mode} ${color} has too little contrast`)
    colors[mode] = color
  }
  return [...row, original, colors.light, colors.dark]
})

// An extension or filename belongs to the first language listing it as its primary extension, else the first listing
// it at all, in `common` order then by name.
const index = new Map(rows.map((row, position) => [row[0], position]))
const extensions = {}
for (const primary of [true, false]) {
  for (const name of names) {
    const list = document[name].extensions ?? []
    for (const [position, extension] of list.entries()) {
      if (primary && position > 0) continue
      const key = extension.replace(/^\./, '').toLowerCase()
      if (!(key in extensions)) extensions[key] = index.get(name)
    }
  }
}
const filenames = {}
for (const name of names) {
  for (const filename of document[name].filenames ?? []) if (!(filename in filenames)) filenames[filename] = index.get(name)
}
const aliases = {}
// Aliases name languages in other tools' terms (`sh`, `bash`, `golang`); data and prose languages keep only their name.
for (const name of names) {
  if (!colored(name) && rank(name) === common.length) {
    aliases[name.toLowerCase()] ??= index.get(name)
    continue
  }
  for (const alias of [name.toLowerCase(), ...(document[name].aliases ?? [])]) if (!(alias in aliases)) aliases[alias] = index.get(name)
}

const sorted = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => byName(a, b)))
const lines = (value, key) =>
  `export const ${key} = {\n${Object.entries(value)
    .map(([name, position]) => `  ${JSON.stringify(name)}: ${position},`)
    .join('\n')}\n}\n`
writeFileSync(
  new URL('languages.js', output),
  `// Generated by packages/renderers/sdk/scripts/linguist.mjs from GitHub Linguist ${release} lib/linguist/languages.yml
// (${repository}, MIT, see LICENSE in this directory). Do not edit; run the script to regenerate.
//
// Each language: [name, type, group, Linguist color, light-theme color, dark-theme color]. Theme colors are the
// Linguist hue calibrated to the Projector palette (profile ${profileName}: chroma at most ${profile.light.chroma} light and
// ${profile.dark.chroma} dark, lightness in one band per theme, at least ${minimum}:1 against the default stage
// background) and, for common languages, moved until clearly apart from the colors of more common ones.

export const release = ${JSON.stringify(release)}

export const languages = [
${rows.map(row => `  ${JSON.stringify(row)},`).join('\n')}
]

/** Lowercase extension (without the dot) → language index. */
${lines(sorted(extensions), 'extensions')}
/** Exact filename → language index. */
${lines(sorted(filenames), 'filenames')}
/** Lowercase name or alias → language index. */
${lines(sorted(aliases), 'aliases')}`,
)
writeFileSync(new URL('LICENSE', output), license)
writeFileSync(
  new URL('vendor.json', output),
  `${JSON.stringify({name: 'github-linguist/linguist languages.yml', version: release, license: 'MIT', source: `${repository}/blob/${release}/lib/linguist/languages.yml`}, null, 2)}\n`,
)
console.log(`${rows.length} languages, ${rows.filter(row => row[3]).length} colored, ${Object.keys(extensions).length} extensions`)
