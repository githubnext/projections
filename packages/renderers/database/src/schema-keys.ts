import type {Entity} from '@githubnext/projections-schemas'
import {compareIds} from '@githubnext/projections-renderer-kit'
import type {SchemaKeyRow, SchemaMarker, SchemaState} from './schema.js'
import {isCard, isColumn, isPrimaryKey, isTable, keyColumnNames, keyKinds, keyType} from './vocabulary.js'
import type {Cards} from './schema-model.js'

/** Keys and indexes: the table that holds each, and the columns it covers. */
export function keysOf(state: SchemaState, {nodes, tables, tableSet, tableOf, columnNamed}: Cards) {
  const isKey = (entity: Entity | undefined) => entity !== undefined && !isCard(entity) && !isColumn(entity)
  const owners = new Map<string, string>()
  for (const edge of state.relationships)
    if (tableSet.has(edge.from) && isTable(nodes.get(edge.from)) && isKey(nodes.get(edge.to)) && !owners.has(edge.to))
      owners.set(edge.to, edge.from)
  const keyEdges = new Map<string, string[]>()
  for (const edge of state.relationships)
    if (isKey(nodes.get(edge.from)) && tableOf.has(edge.to)) keyEdges.set(edge.from, [...(keyEdges.get(edge.from) ?? []), edge.to])
  const keyColumns = new Map<string, string[]>()
  for (const [id, node] of nodes) {
    if (!isKey(node)) continue
    const declared =
      typeof node.data?.table === 'string'
        ? tables.find(table => table === node.data!.table || nodes.get(table)!.label === node.data!.table)
        : undefined
    const table =
      owners.get(id) ??
      declared ??
      keyEdges
        .get(id)
        ?.map(column => tableOf.get(column))
        .find(Boolean)
    if (!table || !isTable(nodes.get(table))) continue
    owners.set(id, table)
    const named = keyColumnNames(node)
      .map(name => columnNamed(table, name))
      .filter((column): column is string => column !== undefined)
    keyColumns.set(id, named.length ? named : (keyEdges.get(id) ?? []).filter(column => tableOf.get(column) === table))
  }
  return {owners, keyColumns}
}

/** Primary-key columns, declared on the column or by a primary-key constraint, and those that are a key on their own. */
export function primaryColumns({nodes, tables, columnsOf}: Cards, keyColumns: ReadonlyMap<string, string[]>) {
  const primary = new Set<string>()
  const singlePrimary = new Set<string>()
  for (const table of tables) {
    const declared = columnsOf.get(table)!.filter(id => nodes.get(id)!.data?.primaryKey === true)
    for (const id of declared) primary.add(id)
    if (declared.length === 1) singlePrimary.add(declared[0]!)
  }
  for (const [id, columns] of keyColumns) {
    if (!isPrimaryKey(nodes.get(id))) continue
    for (const column of columns) primary.add(column)
    if (columns.length === 1) singlePrimary.add(columns[0]!)
    else for (const column of columns) singlePrimary.delete(column)
  }
  return {primary, singlePrimary}
}

/**
 * A single-column primary key or foreign-key constraint is its column's marker (which this records); every other key
 * is a row of its table.
 */
export function keyRowsOf(
  nodes: Cards['nodes'],
  keyColumns: ReadonlyMap<string, string[]>,
  owners: ReadonlyMap<string, string>,
  markers: ReadonlyMap<string, SchemaMarker>,
) {
  const keyRows = new Map<string, SchemaKeyRow>()
  const rowsOf = new Map<string, string[]>()
  for (const id of [...keyColumns.keys()].sort(compareIds)) {
    const node = nodes.get(id)!
    const type = keyType(node)
    const columns = keyColumns.get(id)!
    const marker = columns.length === 1 ? markers.get(columns[0]!) : undefined
    if (marker && !marker.key && ((type === 'primary-key' && marker.label === 'PK') || (type === 'foreign-key' && marker.label === 'FK'))) {
      marker.key = id
      continue
    }
    const [code, title] = keyKinds[type] ?? ['', type]
    const covered = keyColumnNames(node).length ? keyColumnNames(node) : columns.map(column => nodes.get(column)!.label)
    const generated = `${type} (${covered.join(', ')})`
    const name =
      typeof node.data?.databaseName === 'string' && node.data.databaseName
        ? node.data.databaseName
        : node.label !== generated
          ? node.label
          : undefined
    keyRows.set(id, {
      marker: code,
      title,
      text: covered.length && code ? covered.join(', ') : node.label,
      ...(name && covered.length && code ? {name} : {}),
    })
    rowsOf.set(owners.get(id)!, [...(rowsOf.get(owners.get(id)!) ?? []), id])
  }
  return {keyRows, rowsOf}
}
