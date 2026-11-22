// What a modified card lists of its data changes in the diff.
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {fieldLines} from '@githubnext/projections-renderer-kit'
import type {FieldLine} from '@githubnext/projections-renderer-kit'

const isRecord = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Bulky fields a card names (`capability modules changed`) before it only counts the rest. */
const namedBulky = 2

/** A data field's name in plain words: `testTokens` and `test_tokens` read `test tokens`. */
export function fieldWords(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .trim()
    .toLowerCase()
}

/**
 * A modified card's data changes in the diff, leaving out the fields in `shown`, which the card draws and marks itself
 * (its size, `40K → 48K`, and its badges, labels, highlights and tags, gained and lost). Each field is named in plain
 * words (`test tokens`), and numbers of a thousand or more read compactly in `locale` (`12K → 14K`). Fields holding
 * objects are too bulky for a card: the first two are named (`capability modules changed`), any more counted in one
 * line after them (`2 more fields changed`), and the host's details show them.
 */
export function cardChanges(row: EntityChange<Entity>, shown: readonly string[] = [], locale?: string): FieldLine[] {
  const lines = fieldLines(row, {exclude: shown})
  const bulky = (line: FieldLine) => [row.before, row.after].some(side => isRecord(side?.data?.[line.key]))
  const compact = new Intl.NumberFormat(locale, {notation: 'compact', maximumFractionDigits: 1})
  const number = (text: string) => (/^-?\d+(?:\.\d+)?$/u.test(text) && Math.abs(Number(text)) >= 1000 ? compact.format(Number(text)) : text)
  const plain = lines
    .filter(line => !bulky(line))
    .map(line => ({...line, key: fieldWords(line.key), before: number(line.before), after: number(line.after), prose: true as const}))
  const objects = lines.filter(bulky)
  const named = objects.slice(0, objects.length > namedBulky ? namedBulky - 1 : namedBulky)
  const rest = objects.length - named.length
  const summary = (key: string): FieldLine => ({key, before: '', after: '', summary: true})
  return [
    ...plain,
    ...named.map(line => summary(`${fieldWords(line.key)} changed`)),
    ...(rest ? [summary(`${rest} ${plain.length || named.length ? 'more ' : ''}${rest === 1 ? 'field' : 'fields'} changed`)] : []),
  ]
}
