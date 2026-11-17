// The Changes scope as kit renderers present it: which items a comparison shows (its changes and their context), and
// how a list folds the runs of items it doesn't show.
import {changeContext, humanizeKind, isContainment, isScopeChange, scopeRows} from '@githubnext/projections-renderer-sdk/presentation'
import type {ChangesScope, PresentedStep} from '@githubnext/projections-renderer-sdk/presentation'
import type {FilterPayload} from '@githubnext/projections-renderer-sdk/protocol'
import type {Extraction} from '@githubnext/projections-schemas'
import type {ComparisonModel} from './model.js'

export type {ChangesScope} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * The Changes scope a renderer presents, or undefined when the host shows every item (or this is one extraction). The
 * host's filter `ids` are what it shows, its changes and their context; past the filter's ID limit, or before the host
 * says, the kit derives the same from the comparison's structure (`changeContext`).
 */
export function changesScope(model: ComparisonModel | undefined, filter: FilterPayload | undefined): ChangesScope | undefined {
  if (!model || model.mode !== 'comparison' || !filter?.changesOnly) return undefined
  if (filter.ids === null) return changeContext(scopeRows(model), model)
  const shown = new Set(filter.ids)
  const changes = new Set<string>()
  const context = new Set<string>()
  for (const row of [...model.entities, ...model.relationships]) {
    if (!shown.has(row.id)) continue
    if (isScopeChange(row)) changes.add(row.id)
    else context.add(row.id)
  }
  return {changes, context, shown}
}

/**
 * The Changes scope as a kit renderer receives it (`RendererProps.scope`): what it shows, every item's model, and a way
 * to show more of it.
 */
export interface ScopeView extends ChangesScope {
  /** The model of every item: what a canvas's `model` (`MountOptions.scope` `subset`) narrows. */
  all: ComparisonModel
  /**
   * Shows these items too, or a fold's parts (`isFold`), as opening a fold does, until the host's scope changes. A
   * canvas lays them out with the rest.
   */
  expand(ids: Iterable<string>): void
}

/** One entry of a folded list: an item it shows, or a fold standing for a run of items it doesn't. */
export type Folded<T> = {type: 'item'; item: T} | {type: 'fold'; key: string; items: T[]}

/**
 * A list with every run of items `shown` leaves out folded into one entry, keyed by its first item, unless `expanded`
 * names it; a run of one item stays, as its fold would take as much room. Every item is shown when `shown` is
 * undefined. Fold the union of a comparison (or each pane's list in the union's order) so both revisions fold alike.
 */
export function foldList<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  shown: ReadonlySet<string> | undefined,
  expanded: ReadonlySet<string> = new Set(),
): Folded<T>[] {
  if (!shown) return items.map(item => ({type: 'item', item}))
  const entries: Folded<T>[] = []
  let run: T[] = []
  const flush = () => {
    const key = run.length ? idOf(run[0]!) : ''
    if (run.length > 1 && !expanded.has(key)) entries.push({type: 'fold', key, items: run})
    else for (const item of run) entries.push({type: 'item', item})
    run = []
  }
  for (const item of items) {
    if (shown.has(idOf(item))) {
      flush()
      entries.push({type: 'item', item})
    } else run.push(item)
  }
  flush()
  return entries
}

/**
 * How `scopedModel` treats the parts of a shown entity (the items it contains): left out; kept whole, for a card that
 * draws its parts as one; or folded, each entity's left-out parts standing as one more part, a fold (`foldPrefix`).
 */
export type ScopedParts = 'omit' | 'whole' | 'fold'

/** The ID prefix of a fold `scopedModel` adds: `pk-fold:` and the row ID of the entity whose parts it stands for. */
export const foldPrefix = 'pk-fold:'

/** Whether an item is a fold of left-out parts (`scopedModel` with `parts: 'fold'`), which opens with `ScopeView.expand`. */
export const isFold = (id: string) => id.startsWith(foldPrefix)

/** A model of only what a scope shows (`scopedModel`), and the parts each fold in it stands for. */
export interface ScopedModel<X extends Extraction = Extraction> {
  model: ComparisonModel<X>
  /** Each fold's left-out parts, by the fold's ID. */
  folds: ReadonlyMap<string, readonly string[]>
}

type Side = 'before' | 'after'
const sides: readonly Side[] = ['before', 'after']

/** Each entity row's parts (the rows it contains), in either revision. */
function partsOf(model: ComparisonModel): Map<string, Set<string>> {
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

/**
 * A model of only what a scope shows, for a canvas to lay out: the shown entities and their `parts` (left out, whole or
 * folded), and the relationships between them. A relationship is kept only when both its ends are: a changed one always
 * is (its ends are its context), an unchanged one between shown items stays, and none is ever drawn to an item the
 * scope leaves out. Steps keep their kept rows, and a step left with none is dropped. Every other item takes no room.
 * A fold is an unchanged entity of its parts' most common kind, labeled with their counts and contained by its entity
 * in each revision that has it.
 */
export function scopedModel<X extends Extraction>(
  model: ComparisonModel<X>,
  shown: ReadonlySet<string>,
  parts: ScopedParts = 'omit',
): ScopedModel<X> {
  const entities = new Set(model.entities.filter(row => shown.has(row.id)).map(row => row.id))
  const contained = parts === 'omit' ? undefined : partsOf(model)
  if (parts === 'whole' && contained) {
    const stack = [...entities]
    for (let id = stack.pop(); id !== undefined; id = stack.pop())
      for (const child of contained.get(id) ?? [])
        if (!entities.has(child)) {
          entities.add(child)
          stack.push(child)
        }
  }
  const endsShown = (row: ComparisonModel<X>['relationships'][number]) =>
    sides.every(side => {
      const item = row[side]
      return !item || (entities.has(model.entityRow[side].get(item.from) ?? '') && entities.has(model.entityRow[side].get(item.to) ?? ''))
    })
  const relationships = model.relationships.filter(row => endsShown(row) && (shown.has(row.id) || !isScopeChange(row)))
  const keptRelationships = new Set(relationships.map(row => row.id))
  const entityRows = model.entities.filter(row => entities.has(row.id))
  const folds = new Map<string, string[]>()
  const foldRows: ComparisonModel<X>['entities'] = []
  const foldLinks: ComparisonModel<X>['relationships'] = []
  if (parts === 'fold' && contained) {
    const rows = new Map(model.entities.map(row => [row.id, row]))
    for (const row of entityRows) {
      const hidden = [...(contained.get(row.id) ?? [])].filter(id => !entities.has(id))
      if (!hidden.length) continue
      const hiddenRows = hidden.map(id => rows.get(id)!)
      const kinds = new Map<string, number>()
      for (const part of hiddenRows) kinds.set((part.after ?? part.before)!.kind, (kinds.get((part.after ?? part.before)!.kind) ?? 0) + 1)
      const kind = [...kinds].sort((a, b) => b[1] - a[1])[0]![0]
      const id = `${foldPrefix}${row.id}`
      folds.set(id, hidden)
      const entity = {id, kind, label: foldLabel(hiddenRows), data: {}} as X['entities'][number]
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
  }
  const allEntities = [...entityRows, ...foldRows]
  const allRelationships = [...relationships, ...foldLinks]
  const extraction = (side: Side): X => {
    const items = <T extends {id: string}>(rows: readonly {[key in Side]?: T}[]) => rows.flatMap(row => (row[side] ? [row[side]] : []))
    return {...model[side], entities: items(allEntities), relationships: items(allRelationships)}
  }
  const keepStep = (step: PresentedStep): PresentedStep[] => {
    const kept = {
      entities: step.entities.filter(id => entities.has(id)),
      relationships: step.relationships.filter(id => keptRelationships.has(id)),
    }
    return kept.entities.length || kept.relationships.length ? [{...step, ...kept}] : []
  }
  const reindex = (steps: PresentedStep[]) => steps.map((step, index) => ({...step, index}))
  const rowMap = (side: Side) =>
    new Map([
      ...[...model.entityRow[side]].filter(([, row]) => entities.has(row)),
      ...foldRows.filter(row => row[side]).map(row => [row.id, row.id] as const),
    ])
  return {
    model: {
      ...model,
      before: extraction('before'),
      after: extraction('after'),
      entities: allEntities,
      relationships: allRelationships,
      entityRow: {before: rowMap('before'), after: rowMap('after')},
      steps: reindex(model.steps.flatMap(keepStep)),
      ...(model.reverseSteps ? {reverseSteps: reindex(model.reverseSteps.flatMap(keepStep))} : {}),
    },
    folds,
  }
}
