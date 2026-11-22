import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {classifyChange, compareIds, pluralKind} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel, IconName, SummaryFactItem} from '@githubnext/projections-renderer-kit'
import {isColumn, keyType} from './vocabulary.js'
import {both} from './change-lines.js'
import type {ChangeLine} from './change-lines.js'
import {analyse} from './diff-states.js'

/** Singular and plural nouns for each key kind; other kinds are named verbatim. */
const keyNouns: Record<string, [string, string]> = {
  'primary-key': ['primary key', 'primary keys'],
  'foreign-key': ['foreign key', 'foreign keys'],
  unique: ['unique constraint', 'unique constraints'],
  index: ['index', 'indexes'],
  check: ['check constraint', 'check constraints'],
}
const keyOrder = Object.keys(keyNouns)

/**
 * The summary bar's schema facts: what the kind counts can't say about a comparison, counted from the comparison and
 * the extracted schema, each filtering to the rows it names. Columns of tables in both revisions whose type changed
 * or that were made required or optional; tables, views, enums, columns, keys and other entities renamed (an enum
 * whose only change is its values isn't renamed); and the enums' values, which are data rather than entities: how
 * many there are, with those added and removed (`6 enum values +2`), in one revision too.
 */
export function databaseFacts(model: ComparisonModel): SummaryFactItem[] {
  const {rows, before, after, union, state, owner, lines} = analyse(model)
  const facts: SummaryFactItem[] = []
  const comparing = model.mode === 'comparison'
  const fact = (id: string, ids: readonly string[], noun: readonly [string, string], icon?: IconName) => {
    if (ids.length) {
      facts.push({type: 'fact', id, ...(icon ? {icon} : {}), count: ids.length, noun: {singular: noun[0], plural: noun[1]}, ids: [...ids]})
    }
  }
  const has = (id: string, key: string, word?: string) =>
    (lines.get(id) ?? []).some(line => line.key === key && (!word || line.word === word))
  const survives = (card: string | undefined) => card !== undefined && both(rows.get(card)!)
  const renamed = (row: EntityChange<Entity>, found: readonly ChangeLine[] = []) =>
    both(row) && classifyChange(row) !== 'unchanged' && (row.renamed === true || found.some(line => line.key === 'label'))
  if (comparing) {
    // Columns of tables in both revisions; a column of an added or removed table is part of it.
    const columns = [...owner.keys()].filter(
      id => (union.kinds.get(id) ?? 'column') === 'column' && isColumn(state.entities.get(id)) && survives(owner.get(id)),
    )
    const changed = (test: (id: string) => boolean) => columns.filter(id => both(rows.get(id)!) && test(id))
    fact(
      'column-types',
      changed(id => has(id, 'type')),
      ['column type changed', 'column types changed'],
      'changed',
    )
    fact(
      'columns-required',
      changed(id => has(id, 'nullable', 'Made required')),
      ['column made required', 'columns made required'],
    )
    fact(
      'columns-optional',
      changed(id => has(id, 'nullable', 'Made optional')),
      ['column made optional', 'columns made optional'],
    )
    // Renamed cards, by kind. An enum whose only change is its values is counted by value.
    for (const [kind, noun] of [
      ['table', ['table renamed', 'tables renamed']],
      ['view', ['view renamed', 'views renamed']],
      ['enum', ['enum renamed', 'enums renamed']],
    ] as const) {
      fact(
        `${kind}-renamed`,
        union.tables.filter(id => {
          const row = rows.get(id)!
          return (
            state.entities.get(id)!.kind === kind &&
            renamed(row, row.before && row.after && row.before.label !== row.after.label ? [{key: 'label', word: 'Renamed'}] : [])
          )
        }),
        noun,
        'renamed',
      )
    }
    fact(
      'columns-renamed',
      changed(id => renamed(rows.get(id)!, lines.get(id))),
      ['column renamed', 'columns renamed'],
      'renamed',
    )
    // Keys and indexes of tables in both revisions, by kind.
    const keyIds = [...union.keyRows.keys(), ...[...union.markers.values()].flatMap(marker => (marker.key ? [marker.key] : []))].filter(
      id => survives(owner.get(id)),
    )
    const rank = (kind: string) => (keyOrder.includes(kind) ? keyOrder.indexOf(kind) : keyOrder.length)
    const kinds = [...new Set(keyIds.map(id => keyType(state.entities.get(id)!)))].toSorted((a, b) => rank(a) - rank(b) || compareIds(a, b))
    for (const kind of kinds) {
      const [singular, plural] = keyNouns[kind] ?? [kind, pluralKind(kind)]
      fact(
        `${kind}-renamed`,
        keyIds.filter(id => keyType(state.entities.get(id)!) === kind && rows.has(id) && renamed(rows.get(id)!, lines.get(id))),
        [`${singular} renamed`, `${plural} renamed`],
        'renamed',
      )
    }
    // Everything else the schema draws as tags, by its own kind.
    for (const kind of [...new Set(union.others.map(id => state.entities.get(id)!.kind))].toSorted()) {
      fact(
        `${kind}-renamed`,
        union.others.filter(id => {
          const row = rows.get(id)!
          return (
            state.entities.get(id)!.kind === kind &&
            renamed(row, row.before && row.after && row.before.label !== row.after.label ? [{key: 'label', word: 'Renamed'}] : [])
          )
        }),
        [`${kind} renamed`, `${pluralKind(kind)} renamed`],
        'renamed',
      )
    }
  }
  // The enums' values: data, not entities, so a fact with its own changes, filtering to the enums whose values changed.
  if (union.values.size) {
    const added = [...union.values.keys()].filter(id => !before.values.has(id))
    const removed = [...union.values.keys()].filter(id => !after.values.has(id))
    const enums = [...new Set([...added, ...removed].flatMap(id => (owner.has(id) ? [owner.get(id)!] : [])))]
    facts.push({
      type: 'fact',
      id: 'enum-values',
      count: after.values.size,
      noun: {singular: 'enum value', plural: 'enum values'},
      ...(enums.length ? {ids: enums} : {}),
      ...(comparing && added.length ? {added: added.length} : {}),
      ...(comparing && removed.length ? {removed: removed.length} : {}),
    })
  }
  return facts
}
