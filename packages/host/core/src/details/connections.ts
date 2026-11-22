import type {Row} from '../model.js'
import {changeParts} from './change.js'
import type {ChangePart} from './change.js'

/**
 * A relationship of the item a card is about, or an endpoint of the relationship it is about. `rowId` is the row to
 * select: the relationship for an entity's connections, the endpoint entity for a relationship's.
 */
export interface DetailConnection {
  rowId: string
  direction: 'outgoing' | 'incoming' | 'from' | 'to'
  /** The other end's label (an entity's connection), or the endpoint's (a relationship's). */
  label: string
  /** The relationship's kind. */
  kind: string
  /** The selected row's own label, for an accessible name. */
  rowLabel: string
  parts: ChangePart[]
}

/** Each entity id's row, by its current and former ids. */
function entityRows(rows: readonly Row[]): Map<string, Row> {
  const entityRow = new Map<string, Row>()
  for (const candidate of rows) {
    if (candidate.collection === 'entities') {
      for (const id of [...candidate.after, ...candidate.before, candidate.id]) if (!entityRow.has(id)) entityRow.set(id, candidate)
    }
  }
  return entityRow
}

/** An entity's relationships, outgoing then incoming, each group's changed ones first, up to `max` per direction. */
function entityConnections(row: Row, rows: readonly Row[], max: number) {
  const entityRow = entityRows(rows)
  const labelOf = (id: string | undefined) => (id === undefined ? '' : (entityRow.get(id)?.label ?? id))
  const ids = new Set([...row.after, ...row.before, row.id])
  const outgoing: DetailConnection[] = []
  const incoming: DetailConnection[] = []
  for (const candidate of rows) {
    if (candidate.collection !== 'relationships') continue
    const connection = (direction: 'outgoing' | 'incoming', other: string | undefined): DetailConnection => ({
      rowId: candidate.id,
      direction,
      label: labelOf(other),
      kind: candidate.kind,
      rowLabel: candidate.label,
      parts: changeParts(candidate),
    })
    if (candidate.from !== undefined && ids.has(candidate.from)) outgoing.push(connection('outgoing', candidate.to))
    if (candidate.to !== undefined && ids.has(candidate.to)) incoming.push(connection('incoming', candidate.from))
  }
  // Changed connections first; each group keeps the subject's order.
  const changedFirst = (list: DetailConnection[]) => [...list.filter(item => item.parts.length), ...list.filter(item => !item.parts.length)]
  const connections: DetailConnection[] = []
  let more = 0
  for (const list of [changedFirst(outgoing), changedFirst(incoming)]) {
    connections.push(...list.slice(0, max))
    more += Math.max(0, list.length - max)
  }
  return {connections, more}
}

/** A relationship's endpoints, from then to. */
function relationshipEndpoints(row: Row, rows: readonly Row[]): DetailConnection[] {
  const entityRow = entityRows(rows)
  const connections: DetailConnection[] = []
  for (const [direction, id] of [
    ['from', row.from],
    ['to', row.to],
  ] as const) {
    const endpoint = id === undefined ? undefined : entityRow.get(id)
    if (endpoint) {
      connections.push({
        rowId: endpoint.id,
        direction,
        label: endpoint.label,
        kind: row.kind,
        rowLabel: endpoint.label,
        parts: changeParts(endpoint),
      })
    }
  }
  return connections
}

/** A row's connections: an entity's outgoing and incoming relationships, or a relationship's endpoints. */
export function rowConnections(row: Row, rows: readonly Row[], max: number): {connections: DetailConnection[]; more: number} {
  return row.collection === 'entities' ? entityConnections(row, rows, max) : {connections: relationshipEndpoints(row, rows), more: 0}
}
