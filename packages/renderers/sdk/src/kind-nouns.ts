// The host's words for an extraction kind: English plurals, adjectives and phrases.
import type {SummaryNoun} from './protocol.js'

const prepositions = new Set(['on', 'to', 'by', 'of', 'from', 'in', 'for', 'with', 'at', 'into'])
/** Words whose plural is the same word. */
const invariant = new Set(['many', 'data', 'metadata', 'info', 'information', 'series', 'species', 'news', 'software', 'code'])
/** Whole kinds (as words) English names with another noun. */
const phrases: Readonly<Record<string, SummaryNoun>> = {
  'depends on': {singular: 'dependency', plural: 'dependencies'},
  'depends upon': {singular: 'dependency', plural: 'dependencies'},
  person: {singular: 'person', plural: 'people'},
  child: {singular: 'child', plural: 'children'},
}

/** Prefixes a kind keeps hyphenated, as one word: `pre-release` → `pre-releases`, `self-hosted`. */
const prefixHyphen = /(^|[^A-Za-z])(pre|post|non|re|co|sub|multi|self|anti|semi|cross)-(?=[a-z])/gi
/** First words that make the kind an adjective phrase: `not-patchable` → `5 not patchable`. */
const negations = new Set(['not', 'non', 'un', 'no'])
/** Common adjectives a kind may be, which take no plural: `24 hidden`, `3 deprecated`. */
const adjectives = new Set(
  [
    'hidden used open broken frozen private public internal external experimental optional stable',
    'unstable beta alpha legacy readonly only new old dead live active inactive global local static',
    'dynamic abstract final sealed virtual async sync generic nullable mutable immutable obsolete',
    'transient persistent sensitive insecure secure unsafe safe pure impure flaky slow fast large small',
    'empty unknown invalid valid',
  ]
    .join(' ')
    .split(' '),
)
/** Nouns the adjective endings below would misread: `variable`, `table`, `embed`, `hundred`. */
const adjectiveLike = new Set(
  [
    'variable table cable observable executable deliverable timetable syllable vegetable constable',
    'receivable payable consumable collectible bible crucible enable disable embed hundred kindred hatred',
  ]
    .join(' ')
    .split(' '),
)

/** Whether a kind's words read as an adjective (`hidden`, `deprecated`, `not patchable`), which English counts without a plural. */
export function adjectivalKind(words: readonly string[]): boolean {
  const first = words[0]?.toLowerCase() ?? ''
  const last = words.at(-1)?.toLowerCase() ?? ''
  if (words.length > 1 && negations.has(first)) return true
  if (adjectiveLike.has(last)) return false
  if (adjectives.has(last)) return true
  return (last.length > 4 && /[^e]ed$/.test(last)) || (last.length > 5 && /(?:able|ible|ous|less)$/.test(last))
}

/** A word's English plural, by the simple rules: `class` → `classes`, `policy` → `policies`, `key` → `keys`. */
export function pluralWord(word: string): string {
  if (invariant.has(word.toLowerCase())) return word
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`
  if (/is$/i.test(word)) return `${word.slice(0, -2)}es`
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`
  return `${word}s`
}

/** Names written in lowercase even at the start of a sentence: tools whose own spelling is lowercase (`npm`, not `Npm`). */
const lowercaseNames = new Set(['npm', 'pnpm', 'npx', 'kubectl', 'systemd'])

/**
 * Text as it starts a sentence or a label: its first letter capitalized (`data source` → `Data source`), unless its
 * first word is a name written in lowercase (`npm package` stays `npm package`; see `lowercaseNames`).
 */
export function sentenceCase(text: string): string {
  const first = /^[^\s\-_.:/]*/.exec(text)![0]
  return lowercaseNames.has(first) ? text : text.charAt(0).toUpperCase() + text.slice(1)
}

/** A kind's words: camel case, kebab case and snake case split, capitalized words lowercased (`devDependencies` → `dev dependencies`). */
export function kindWords(kind: string): string[] {
  return kind
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s\-_.:/]+/)
    .filter(Boolean)
    .map(word => (/^[A-Z][a-z0-9]*$/.test(word) || /^[a-z0-9]+$/.test(word) ? word.toLowerCase() : word))
}

/**
 * The host's word for an extraction kind, when the renderer gives none: its words (`target-framework` → `target
 * framework`), with a simple English plural (`workspace` → `workspaces`, `policy` → `policies`). A kind already in the
 * plural keeps it and is made singular (`dependencies` → `dependency`, `imports` → `import`); a kind ending in a
 * preposition reads the same in both (`applies to`), and so does an adjective (`24 hidden`, `5 not patchable`, `3
 * deprecated`; see `adjectivalKind`); `depends-on` is a dependency. Common prefixes stay hyphenated (`pre-release` →
 * `pre-releases`).
 */
export function humanizeKind(kind: string): SummaryNoun {
  const words = kindWords(kind.replaceAll(prefixHyphen, '$1$2\u2011')).map(word => word.replaceAll('\u2011', '-'))
  if (!words.length) return {singular: kind, plural: kind}
  const phrase = words.join(' ')
  const known = phrases[phrase.toLowerCase()]
  if (known) return known
  const last = words.at(-1)!
  const head = words.slice(0, -1)
  const noun = (singular: string, plural: string) => ({singular: [...head, singular].join(' '), plural: [...head, plural].join(' ')})
  if (words.length > 1 && prepositions.has(last.toLowerCase())) return {singular: phrase, plural: phrase}
  if (invariant.has(last.toLowerCase()) || adjectivalKind(words)) return {singular: phrase, plural: phrase}
  // Already plural: make the singular.
  if (/[^aeiou]ies$/i.test(last) && last.length > 4) return noun(`${last.slice(0, -3)}y`, last)
  if (/(ss|x|z|ch|sh)es$/i.test(last)) return noun(last.slice(0, -2), last)
  if (/[^su]s$/i.test(last) && !/(is|ss)$/i.test(last)) return noun(last.slice(0, -1), last)
  return noun(last, pluralWord(last))
}
