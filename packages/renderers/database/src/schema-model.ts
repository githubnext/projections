import {compareIds, isFold} from '@githubnext/projections-renderer-kit'
import type {CardText, RowText} from './text.js'
import {columnType} from './types.js'
import type {SchemaKeyRow, SchemaModel, SchemaRowKind, SchemaState} from './schema.js'
import {enumValueId, enumValues, isCard, isColumn, isEnum, isTable, keyOrder, keyType} from './vocabulary.js'
import {keyRowsOf, keysOf, primaryColumns} from './schema-keys.js'
import {columnMarkers, linksOf} from './schema-links.js'
/** Longest-path depth from the roots; cycles keep the depth they reached. */
export function layerDepths(nodes: readonly string[], edges: readonly {from: string; to: string}[]): Map<string, number> {
  const incoming = new Map(nodes.map(id => [id, 0]))
  const outgoing = new Map(nodes.map(id => [id, new Set<string>()]))
  for (const edge of edges) {
    if (edge.from === edge.to || !outgoing.has(edge.from) || !incoming.has(edge.to) || outgoing.get(edge.from)!.has(edge.to)) continue
    outgoing.get(edge.from)!.add(edge.to)
    incoming.set(edge.to, incoming.get(edge.to)! + 1)
  }
  const depth = new Map<string, number>()
  const queue = nodes.filter(id => incoming.get(id) === 0)
  for (const id of queue) depth.set(id, 0)
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!
    for (const child of outgoing.get(id) ?? []) {
      depth.set(child, Math.max(depth.get(child) ?? 0, (depth.get(id) ?? 0) + 1))
      incoming.set(child, incoming.get(child)! - 1)
      if (incoming.get(child) === 0) queue.push(child)
    }
  }
  for (const id of nodes) if (!depth.has(id)) depth.set(id, 0)
  return depth
}

/** A state's cards (tables, views and enums, in ID order) and the columns each table holds. */
export function cardsOf(state: SchemaState) {
  const nodes = state.entities
  const tables = [...nodes]
    .filter(([, entity]) => isCard(entity))
    .map(([id]) => id)
    .sort(compareIds)
  const tableSet = new Set(tables)
  const columnsOf = new Map(tables.map(id => [id, [] as string[]]))
  const tableOf = new Map<string, string>()
  for (const edge of state.relationships) {
    if (tableSet.has(edge.from) && isTable(nodes.get(edge.from)) && isColumn(nodes.get(edge.to)) && !tableOf.has(edge.to)) {
      columnsOf.get(edge.from)!.push(edge.to)
      tableOf.set(edge.to, edge.from)
    }
  }
  const columnNamed = (table: string, name: string) => columnsOf.get(table)?.find(id => nodes.get(id)!.label === name)
  return {nodes, tables, tableSet, columnsOf, tableOf, columnNamed}
}

export type Cards = ReturnType<typeof cardsOf>

/** Each card's rows: a table's columns then its keys in kind order, an enum's values. */
function cardRows(
  {nodes, tables}: Cards,
  ordered: ReadonlyMap<string, string[]>,
  keyRows: ReadonlyMap<string, SchemaKeyRow>,
  rowsOf: ReadonlyMap<string, string[]>,
) {
  const kinds = new Map<string, SchemaRowKind>()
  const values = new Map<string, string>()
  const columns = new Map<string, string[]>()
  for (const table of tables) {
    if (isEnum(nodes.get(table))) {
      const ids = enumValues(nodes.get(table)!).map(value => {
        const id = enumValueId(table, value)
        values.set(id, value)
        kinds.set(id, 'value')
        return id
      })
      columns.set(table, ids)
      continue
    }
    const keys = (rowsOf.get(table) ?? []).sort((a, b) => {
      const order = (id: string) => {
        const index = keyOrder.indexOf(keyType(nodes.get(id)!))
        return index < 0 ? keyOrder.length : index
      }
      return order(a) - order(b) || compareIds(keyRows.get(a)!.text, keyRows.get(b)!.text) || compareIds(a, b)
    })
    for (const key of keys) kinds.set(key, 'key')
    columns.set(table, [...ordered.get(table)!, ...keys])
  }
  return {kinds, values, columns}
}

/** What each card and row shows in this state, for sizing them. */
function cardTexts(
  {nodes, tables}: Cards,
  columns: ReadonlyMap<string, string[]>,
  keyRows: ReadonlyMap<string, SchemaKeyRow>,
  values: ReadonlyMap<string, string>,
) {
  const texts = {cards: new Map<string, CardText>(), rows: new Map<string, RowText>()}
  for (const table of tables) {
    const entity = nodes.get(table)!
    texts.cards.set(table, {label: entity.label, kind: entity.kind === 'view' || entity.kind === 'enum' ? entity.kind : undefined})
    for (const id of columns.get(table)!) {
      const key = keyRows.get(id)
      texts.rows.set(
        id,
        key
          ? {kind: 'key', text: key.text, name: key.name}
          : values.has(id)
            ? {kind: 'value', text: values.get(id)!}
            : // A fold of the columns the Changes scope leaves out is one line of words, measured as a value is.
              isFold(id)
              ? {kind: 'value', text: nodes.get(id)!.label}
              : {kind: 'column', name: nodes.get(id)!.label, type: columnType(nodes.get(id)!)},
      )
    }
  }
  return texts
}

/** Cards, their ordered rows, key roles and markers, and foreign-key and enum links of one state. */
export function buildModel(state: SchemaState): SchemaModel {
  const cards = cardsOf(state)
  const {nodes, tables, tableOf} = cards
  const {owners, keyColumns} = keysOf(state, cards)
  const {primary, singlePrimary} = primaryColumns(cards, keyColumns)
  const {links, foreign} = linksOf(state, cards)
  const {roles, markers, ordered} = columnMarkers(cards, primary, singlePrimary, foreign)
  const {keyRows, rowsOf} = keyRowsOf(nodes, keyColumns, owners, markers)
  const {kinds, values, columns} = cardRows(cards, ordered, keyRows, rowsOf)
  const rank = layerDepths(
    tables,
    links.map(link => ({from: link.principal, to: link.dependent})),
  )
  const held = new Set([...keyRows.keys(), ...[...markers.values()].flatMap(marker => (marker.key ? [marker.key] : []))])
  const others = [...nodes]
    .filter(([id, entity]) => !isCard(entity) && !isColumn(entity) && !tableOf.has(id) && !held.has(id))
    .map(([id]) => id)
  const texts = cardTexts(cards, columns, keyRows, values)
  return {tables, columns, kinds, roles, markers, keyRows, values, links, rank, others, texts}
}
