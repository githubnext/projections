import type {Varied} from '@githubnext/projections-schemas'
import {
  generatedPaths,
  generatedText,
  generatedWords,
  variedName,
  variedValue,
  wordDiff,
} from '@githubnext/projections-renderer-sdk/presentation'
import type {BasisValue, WordRun} from '@githubnext/projections-renderer-sdk/presentation'
import type {Row, ViewSubject} from '../model.js'
import type {rowItems} from '../model.js'

/**
 * One generated value of a detail card (a summary a language model wrote, say): its name, its values on each side,
 * the comparison's `varied` entry when it differs, and both sides' bases. Cards show these first, marked Generated,
 * with the kit's `GeneratedText` forms; their bases are left out of `fields`.
 */
export interface GeneratedField {
  /** The pointer into the item, under `/data/`. */
  path: string
  /** The path below `/data/` as written (`summary`). */
  name: string
  before?: unknown
  after?: unknown
  /** The comparison's entry when the value differs: within when regenerated from the same inputs. */
  entry?: Varied
  bases: {before?: BasisValue; after?: BasisValue}
}

const basisOf = (value: unknown): BasisValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as BasisValue) : undefined

/**
 * How a detail card presents a generated value: `plain` (it didn't differ, or one extraction), `regenerated` (from
 * the same inputs: After's text, with Before's wording a toggle away) or `changed` (its basis moved: both passages,
 * why, and a word diff for strings). `words` is protocol prose (code in backtick spans).
 */
export interface GeneratedForm {
  form: 'plain' | 'regenerated' | 'changed'
  before?: string
  after?: string
  /** Whether the value isn't a string, so it shows as JSON in mono, without a word diff. */
  json: boolean
  words?: string
  /** A changed value whose text didn't change: one passage, "the wording is the same". */
  same: boolean
  runs?: WordRun[]
}

/** A generated field's presentation (see `GeneratedForm`). */
export function generatedForm(field: GeneratedField): GeneratedForm {
  const json = [field.before, field.after].some(value => value !== undefined && typeof value !== 'string')
  const before = field.before === undefined ? undefined : generatedText(field.before)
  const after = field.after === undefined ? undefined : generatedText(field.after)
  const sides = {...(before === undefined ? {} : {before}), ...(after === undefined ? {} : {after})}
  if (!field.entry) return {form: 'plain', ...sides, json, same: true}
  const words = generatedWords(field.entry, field.bases)
  if (field.entry.within) return {form: 'regenerated', ...sides, json, words, same: before === after}
  const same = before !== undefined && before === after
  const runs = !json && !same && before !== undefined && after !== undefined ? wordDiff(before, after) : undefined
  return {form: 'changed', ...sides, json, words: same ? `${words}; the wording is the same` : words, same, ...(runs ? {runs} : {})}
}

/**
 * A row's generated values, as the extractions declare them, with their values and bases on each side; and `hidden`,
 * the pointers of the values and their bases, which the card's other fields leave out.
 */
export function generatedFields(
  subject: ViewSubject,
  row: Row,
  items: ReturnType<typeof rowItems>,
): {generated: GeneratedField[]; hidden: Set<string>} {
  const comparing = subject.mode === 'comparison'
  const declared = new Map<string, string>()
  for (const [side, extraction] of comparing
    ? ([
        ['before', subject.before],
        ['after', subject.after],
      ] as const)
    : ([['after', subject.extraction]] as const))
    for (const {path, basis} of generatedPaths(extraction, items[side][0], row.collection))
      if (!declared.has(path)) declared.set(path, basis)
  const hidden = new Set([...declared.keys(), ...declared.values()])
  const generated: GeneratedField[] = [...declared].map(([path, basis]) => {
    const entry = (row.varied ?? []).find(candidate => candidate.path === path && candidate.generated)
    const before = comparing ? variedValue(items.before[0], path) : undefined
    const after = variedValue(items.after[0], path)
    const bases = {
      ...(comparing && basisOf(variedValue(items.before[0], basis)) ? {before: basisOf(variedValue(items.before[0], basis))!} : {}),
      ...(basisOf(variedValue(items.after[0], basis)) ? {after: basisOf(variedValue(items.after[0], basis))!} : {}),
    }
    return {
      path,
      name: variedName(path),
      ...(before === undefined ? {} : {before}),
      ...(after === undefined ? {} : {after}),
      ...(entry ? {entry} : {}),
      bases,
    }
  })
  return {generated, hidden}
}
