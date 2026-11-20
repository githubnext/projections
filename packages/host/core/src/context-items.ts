// A change's context as agents read it: the items a person needs to read the change, listed by `current_view`.
import {isScopeChange, rowContexts} from '@githubnext/projections-renderer-sdk/presentation'
import type {Row, ViewSubject} from './model.js'

/** The context of one change: some of its items, how many there are, and the comparator rules that added any. */
export interface ContextItems {
  /** The first items of its context, by row: an entity, relationship or change. */
  items: {id: string; label: string; kind: string}[]
  /** How many items its context has. */
  total: number
  /** The comparator `context` rules that added to it. */
  rules?: string[]
  /** Whether it was derived from the structure, as the comparison was saved without context. */
  derived?: true
}

/**
 * Each change's context in a comparison (`rowContexts`): the comparison's, else the structural derivation, at most
 * `limit` items each. Undefined for a row that isn't a change, or has no context, and for one revision.
 */
export function changeContextItems(rows: readonly Row[], subject: ViewSubject, limit = 20): (row: Row) => ContextItems | undefined {
  if (subject.mode !== 'comparison') return () => undefined
  const contextOf = rowContexts(rows, subject)
  const byId = new Map(rows.map(row => [row.id, row]))
  return row => {
    if (!isScopeChange(row)) return undefined
    const context = contextOf(row)
    if (!context.rows.length) return undefined
    const items = context.rows.slice(0, limit).flatMap(id => {
      const item = byId.get(id)
      return item ? [{id: item.id, label: item.label, kind: item.kind}] : []
    })
    return {
      items,
      total: context.rows.length,
      ...(context.rules.length ? {rules: [...context.rules]} : {}),
      ...(context.derived ? {derived: true as const} : {}),
    }
  }
}
