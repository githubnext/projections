// The Changes scope as kit renderers present it: which items a comparison shows (its changes and their context), and
// how a list folds the runs of items it doesn't show.
import {changeContext, isScopeChange, scopeRows} from '@githubnext/projections-renderer-sdk/presentation'
import type {ChangesScope, PresentedStep} from '@githubnext/projections-renderer-sdk/presentation'
import type {FilterPayload} from '@githubnext/projections-renderer-sdk/protocol'
import type {Extraction} from '@githubnext/projections-schemas'
import type {ComparisonModel} from './model.js'
import {foldParts, foldPrefix, partsOf, sides} from './scope-parts.js'
import type {Side} from './scope-parts.js'

export {foldPrefix} from './scope-parts.js'

export type {ChangesScope} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * The Changes scope a renderer presents, or undefined when the host shows every item (or this is one extraction). The
 * host's filter `scope` is what it shows, its changes and their context, each change with every row presenting it (a
 * split's parts): the summary filter and find recede what they leave out (`ids`), never narrowing what is laid out. A
 * host before `scope` sent it in `ids`. Past the filter's ID limit, or before the host says, the kit reads the same
 * from the comparison's change context, or derives it from the structure for a comparison saved without context
 * (`changeContext`).
 */
export function changesScope(model: ComparisonModel | undefined, filter: FilterPayload | undefined): ChangesScope | undefined {
  if (!model || model.mode !== 'comparison' || !filter?.changesOnly) return undefined
  const ids = filter.scope === undefined ? filter.ids : filter.scope
  if (ids === null) return changeContext(scopeRows(model), model)
  // A split's or merge's further parts are rows of their own: the host's change ID names them all.
  const shown = new Set(ids.flatMap(id => [id, ...(model.changeRows?.get(id) ?? [])]))
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
   * Shows these items too, or opens these folds (`isFold`), until the host's scope changes. A canvas lays them out with
   * the rest; an open fold stays, as the way to fold its parts again.
   */
  expand(ids: Iterable<string>): void
  /** Folds these open folds again, or stops showing items `expand` added. */
  collapse(ids: Iterable<string>): void
}

/**
 * One entry of a folded list: an item it shows, or a fold standing for a run of items it doesn't. An `open` fold's items
 * follow it, and it is the way to fold them again.
 */
export type Folded<T> = {type: 'item'; item: T} | {type: 'fold'; key: string; items: T[]; open?: boolean}

/**
 * A list with every run of items `shown` leaves out folded into one entry, keyed by its first item; a run `expanded`
 * names is listed after its fold, `open`. A run of one item stays, as its fold would take as much room. Every item is shown when `shown` is
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
    if (run.length > 1) {
      const open = expanded.has(key)
      entries.push({type: 'fold', key, items: run, ...(open ? {open} : {})})
      if (open) for (const item of run) entries.push({type: 'item', item})
    } else for (const item of run) entries.push({type: 'item', item})
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

/** Whether an item is a fold of left-out parts (`scopedModel` with `parts: 'fold'`), which opens with `ScopeView.expand`. */
export const isFold = (id: string) => id.startsWith(foldPrefix)

/** A model of only what a scope shows (`scopedModel`), and the parts each fold in it stands for. */
export interface ScopedModel<X extends Extraction = Extraction> {
  /** The model of what the scope shows, with the folds standing for left-out parts. */
  model: ComparisonModel<X>
  /** Each fold's left-out parts, by the fold's ID. */
  folds: ReadonlyMap<string, readonly string[]>
}

/**
 * A model of only what a scope shows, for a canvas to lay out: the shown entities and their `parts` (left out, whole or
 * folded), and the relationships between them. A relationship is kept only when both its ends are: a changed one always
 * is (its ends are its context), an unchanged one between shown items stays, and none is ever drawn to an item the
 * scope leaves out. Steps keep their kept rows, and a step left with none is dropped. Every other item takes no room.
 * A fold is an unchanged entity of its parts' most common kind, labeled with their counts and contained by its entity
 * in each revision that has it. A fold in `open` shows its parts and stays, labeled `Hide …` with `data.open`, as the
 * way to fold them again.
 */
export function scopedModel<X extends Extraction>(
  model: ComparisonModel<X>,
  shown: ReadonlySet<string>,
  parts: ScopedParts = 'omit',
  open: ReadonlySet<string> = new Set(),
): ScopedModel<X> {
  const entities = new Set(model.entities.filter(row => shown.has(row.id)).map(row => row.id))
  const contained = parts === 'omit' ? undefined : partsOf(model)
  if (parts === 'whole' && contained) {
    const stack = [...entities]
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      for (const child of contained.get(id) ?? []) {
        if (!entities.has(child)) {
          entities.add(child)
          stack.push(child)
        }
      }
    }
  }
  // Each shown entity's left-out parts fold into one more part; an open fold shows them, and stays as the way back.
  const {
    folds,
    rows: foldRows,
    links: foldLinks,
  } = parts === 'fold' && contained
    ? foldParts(model, entities, contained, open)
    : {folds: new Map<string, string[]>(), rows: [], links: []}
  const endsShown = (row: ComparisonModel<X>['relationships'][number]) =>
    sides.every(side => {
      const item = row[side]
      return !item || (entities.has(model.entityRow[side].get(item.from) ?? '') && entities.has(model.entityRow[side].get(item.to) ?? ''))
    })
  const relationships = model.relationships.filter(row => endsShown(row) && (shown.has(row.id) || !isScopeChange(row)))
  const keptRelationships = new Set(relationships.map(row => row.id))
  const entityRows = model.entities.filter(row => entities.has(row.id))
  const allEntities = [...entityRows, ...foldRows]
  const allRelationships = [...relationships, ...foldLinks]
  const extraction = (side: Side): X => {
    const items = <T extends {id: string}>(rows: readonly Partial<Record<Side, T>>[]) => rows.flatMap(row => (row[side] ? [row[side]] : []))
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
