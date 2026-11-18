// The parts a scoped model keeps of each shown entity: what contains what, and the folds that stand for the parts the
// scope leaves out.
import {humanizeKind, isContainment} from '@githubnext/projections-renderer-sdk/presentation'
import type {Extraction} from '@githubnext/projections-schemas'
import type {ComparisonModel} from './model.js'

/** The ID prefix of a fold `scopedModel` adds: `pk-fold:` and the row ID of the entity whose parts it stands for. */
export const foldPrefix = 'pk-fold:'

/** One revision of a comparison. */
export type Side = 'before' | 'after'
/** The two revisions of a comparison, in order. */
export const sides: readonly Side[] = ['before', 'after']

/** Each entity row's parts (the rows it contains), in either revision. */
export function partsOf(model: ComparisonModel): Map<string, Set<string>> {
  const parts = new Map<string, Set<string>>()
  for (const side of sides) {
    const contains = isContainment(model[side])
    const rowOf = model.entityRow[side]
    for (const relationship of model[side].relationships) {
      if (!contains(relationship)) continue
      const parent = rowOf.get(relationship.from)
      const child = rowOf.get(relationship.to)
      if (parent === undefined || child === undefined || parent === child) continue
      const list = parts.get(parent) ?? new Set<string>()
      list.add(child)
      parts.set(parent, list)
    }
  }
  return parts
}

/**
 * A fold's label: `7 unchanged columns` for parts of one kind, else `Unchanged: 6 columns, 1 primary key and 2 indexes`,
 * the most numerous kind first.
 */
function foldLabel(rows: readonly {before?: {kind: string}; after?: {kind: string}}[]): string {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const kind = (row.after ?? row.before)!.kind
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const words = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => {
      const noun = humanizeKind(kind)
      return `${count.toLocaleString('en-US')} ${count === 1 ? noun.singular : noun.plural}`
    })
  if (words.length === 1) return words[0]!.replace(/^(\S+) /, '$1 unchanged ')
  return `Unchanged: ${words.slice(0, -1).join(', ')} and ${words.at(-1)!}`
}

/** A scoped model's folds: each fold's parts, and the rows and `contains` links that add the folds to the model. */
export interface FoldedParts<X extends Extraction> {
  folds: Map<string, string[]>
  rows: ComparisonModel<X>['entities']
  links: ComparisonModel<X>['relationships']
}

/**
 * Folds each shown entity's left-out parts into one more part, an unchanged entity of their most common kind labeled
 * with their counts; a fold in `open` adds its parts to `entities` and stays, labeled `Hide …` with `data.open`, as the
 * way to fold them again.
 */
export function foldParts<X extends Extraction>(
  model: ComparisonModel<X>,
  entities: Set<string>,
  contained: Map<string, Set<string>>,
  open: ReadonlySet<string>,
): FoldedParts<X> {
  const folds = new Map<string, string[]>()
  const foldRows: ComparisonModel<X>['entities'] = []
  const foldLinks: ComparisonModel<X>['relationships'] = []
  const rows = new Map(model.entities.map(row => [row.id, row]))
  for (const row of model.entities.filter(item => entities.has(item.id))) {
    const hidden = [...(contained.get(row.id) ?? [])].filter(id => !entities.has(id))
    if (!hidden.length) continue
    const hiddenRows = hidden.map(id => rows.get(id)!)
    const kinds = new Map<string, number>()
    for (const part of hiddenRows) kinds.set((part.after ?? part.before)!.kind, (kinds.get((part.after ?? part.before)!.kind) ?? 0) + 1)
    const kind = [...kinds].sort((a, b) => b[1] - a[1])[0]![0]
    const id = `${foldPrefix}${row.id}`
    folds.set(id, hidden)
    const label = foldLabel(hiddenRows)
    const opened = open.has(id)
    const entity = {
      id,
      kind,
      label: opened ? `Hide ${label[0]!.toLowerCase()}${label.slice(1)}` : label,
      data: opened ? {open: true} : {},
    } as X['entities'][number]
    foldRows.push({
      id,
      ...(row.before ? {before: entity} : {}),
      ...(row.after ? {after: entity} : {}),
      status: 'unchanged',
      correspondence: 'exact',
    })
    const link = (side: Side) => ({id: `${id}:contains`, kind: 'contains', from: row[side]!.id, to: id}) as X['relationships'][number]
    foldLinks.push({
      id: `${id}:contains`,
      ...(row.before ? {before: link('before')} : {}),
      ...(row.after ? {after: link('after')} : {}),
      status: 'unchanged',
      correspondence: 'exact',
    })
  }
  for (const [id, hidden] of folds) if (open.has(id)) for (const part of hidden) entities.add(part)
  return {folds, rows: foldRows, links: foldLinks}
}
