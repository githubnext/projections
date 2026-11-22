import {aliases, extensions, filenames, languages as table, release, type LinguistType} from '../vendor/linguist/languages.js'
import type {ColorMode} from './protocol.js'

/**
 * Programming languages and file types as GitHub Linguist names them, with
 * Linguist's language colors, so a language looks the same in every renderer
 * and as it does on github.com. The table is generated from Linguist's
 * `languages.yml` at a pinned release (`linguistRelease`; MIT, its notice
 * travels with every bundle that includes it). Programming and markup
 * languages have a color, adjusted per theme only as much as it takes to
 * reach 3:1 against the stage background and to stay apart from more common
 * languages; data and prose (JSON, YAML, Markdown) have none, so renderers
 * give them categorical colors.
 */
export interface Language {
  /** Linguist's name, for example `TypeScript`. */
  name: string
  /** Linguist's category: `programming` and `markup` languages have a `color`; `data` and `prose` don't. */
  type: LinguistType
  /** The language a variant is presented as (TSX is TypeScript); its own name otherwise. */
  group: string
  /** Linguist's own color, for programming and markup languages. */
  color?: {linguist: string; light: string; dark: string}
}

/** The Linguist release the language table was generated from, for example `v9.7.0`. */
export const linguistRelease = release

const cache = new Map<number, Language>()
function language(index: number | undefined): Language | undefined {
  if (index === undefined) return undefined
  const known = cache.get(index)
  if (known) return known
  const row = table[index]
  if (!row) return undefined
  const [name, type, group, linguist, light, dark] = row
  const result: Language = {name, type, group: group ?? name, ...(linguist && light && dark ? {color: {linguist, light, dark}} : {})}
  cache.set(index, result)
  return result
}

const own = (record: Readonly<Record<string, number>>, key: string) => (Object.hasOwn(record, key) ? record[key] : undefined)

/**
 * The language of a repository path: by its file name (`Dockerfile`,
 * `Makefile`), else by its longest known extension (`.d.ts` before `.ts`).
 */
export function languageOfPath(path: string): Language | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const byName = own(filenames, name) ?? own(filenames, name.toLowerCase())
  if (byName !== undefined) return language(byName)
  const lower = name.toLowerCase()
  for (let dot = lower.indexOf('.', 1); dot >= 0; dot = lower.indexOf('.', dot + 1)) {
    const found = own(extensions, lower.slice(dot + 1))
    if (found !== undefined) return language(found)
  }
  return lower.startsWith('.') ? language(own(extensions, lower.slice(1))) : undefined
}

/** Names other tools use for languages Linguist names differently (tokei's, as code-statistics reports them). */
const otherNames: Record<string, string> = {
  'c header': 'C',
  'c++ header': 'C++',
  'objective-c++': 'Objective-C++',
  jsx: 'JavaScript',
  'plain text': 'Text',
  'protocol buffers': 'Protocol Buffer',
  'visual basic': 'Visual Basic .NET',
  'emacs lisp': 'Emacs Lisp',
  'f#': 'F#',
}

/** The language a name or alias denotes (`TypeScript`, `ts`, `bash`, `C Header`), ignoring case. */
export function languageNamed(name: string): Language | undefined {
  const key = name.trim().toLowerCase()
  const index = own(aliases, key) ?? own(aliases, otherNames[key]?.toLowerCase() ?? '')
  return language(index)
}

/**
 * A language's color for a theme: the color of its group (TSX is drawn as
 * TypeScript), or `undefined` for data and prose and for languages Linguist
 * gives no color.
 */
export function languageColor(language: Language, colorMode: ColorMode): string | undefined {
  const colored = language.group === language.name ? language : (languageNamed(language.group) ?? language)
  return colored.color?.[colorMode]
}
