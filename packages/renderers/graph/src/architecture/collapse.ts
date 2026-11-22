// Large architecture comparisons: unchanged module boundaries collapse into one summary card each, with their
// relationships joined to it.
import type {Entity, Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {compareIds, isChanged} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'
import {collapseLimit} from './limits.js'

export {collapseAbove, oneRevisionCollapseAbove} from './limits.js'

/** Summary cards, the cards that collapse an expanded boundary again, and their links: drawn, never selected. */
export const summaryPrefix = 'boundary:'
export const restPrefix = 'boundary-rest:'
export const collapsePrefix = 'boundary-collapse:'
const linkPrefix = 'boundary-link:'

/** Which boundaries the person expanded: every one, or these. */
export type Expansion = 'all' | ReadonlySet<string>

/**
 * A summary card (`open` false) or a collapse card: its boundary and how many components it stands for. A summary
 * card that is `rest` stands for the unchanged components of an open boundary, beside its changed ones.
 */
export interface BoundaryCard {
  boundary: string
  count: number
  open: boolean
  rest?: boolean
}

export interface ArchitectureView {
  model: ComparisonModel
  /** Whether the architecture is large enough to collapse (whatever is expanded now). */
  collapsible: boolean
  cards: ReadonlyMap<string, BoundaryCard>
  /** Each joined link's collapsed boundaries, which activating it expands. */
  links: ReadonlyMap<string, readonly string[]>
  /** The boundary each component a summary card hides is in. */
  hidden: ReadonlyMap<string, string>
}

export const isSynthetic = (id: string) =>
  id.startsWith(summaryPrefix) || id.startsWith(restPrefix) || id.startsWith(collapsePrefix) || id.startsWith(linkPrefix)

const shown = <T>(row: EntityChange<T>): T => (row.after ?? row.before)!

const unchanged = <T extends {id: string}>(item: T): EntityChange<T> => ({
  id: item.id,
  before: item,
  after: item,
  status: 'unchanged',
  correspondence: 'exact',
})

/**
 * An architecture with every unchanged boundary collapsed into one summary card (the boundary's name and `data`, and how
 * many components it holds), when it has more than `limit` components (`collapseAbove` for a comparison,
 * `oneRevisionCollapseAbove` for one revision). A boundary stays open when anything in it
 * changed, when a changed relationship touches anything in it, when it holds a `pinned` entity (the selection, or what
 * the host asked to focus) or when the person expanded it; an expanded one that could collapse gets a card to collapse
 * it again. A boundary open for its changes shows its unchanged components (two or more) as one `rest` card beside
 * them, which opens it whole, and then a card closes them again. Relationships into and out of a collapsed boundary join its card, one link per pair of cards. Nested
 * boundaries collapse into their outermost collapsible one. Everything is ordered by ID, so the same documents always
 * present the same graph.
 */
export function architectureView(
  model: ComparisonModel,
  expansion: Expansion,
  pinned: ReadonlySet<string>,
  limit = collapseLimit(model.mode),
): ArchitectureView {
  const children = new Map<string, string[]>()
  const parent = new Map<string, string>()
  for (const row of model.relationships) {
    if (shown(row).kind !== 'contains') continue
    const [source, target] = ends(model, row)
    if (!source || !target) continue
    children.set(source, [...(children.get(source) ?? []), target])
    parent.set(target, source)
  }
  const linked = new Set(model.relationships.filter(row => shown(row).kind !== 'contains').flatMap(row => ends(model, row)))
  const boundaries = new Set(
    model.entities.filter(row => shown(row).kind === 'module' && children.has(row.id) && !linked.has(row.id)).map(row => row.id),
  )
  const collapsible = model.entities.filter(row => !boundaries.has(row.id)).length > limit
  const none: ArchitectureView = {model, collapsible, cards: new Map(), links: new Map(), hidden: new Map()}
  if (!collapsible || expansion === 'all') return none

  const descendants = (id: string): string[] => (children.get(id) ?? []).flatMap(child => [child, ...descendants(child)])
  const changed = new Set(model.entities.filter(isChanged).map(row => row.id))
  for (const row of model.relationships) if (isChanged(row)) for (const id of everyEnd(model, row)) changed.add(id)
  const quiet = (id: string) => !changed.has(id) && !pinned.has(id)
  const closes = (id: string) => quiet(id) && descendants(id).every(quiet)
  // The outermost boundaries that can close: those the person didn't open collapse, the rest get a collapse card.
  const outermost = [...boundaries].toSorted(compareIds).filter(id => {
    if (!closes(id)) return false
    for (let up = parent.get(id); up !== undefined; up = parent.get(up)) if (boundaries.has(up) && closes(up)) return false
    return true
  })
  const collapsed = outermost.filter(id => !expansion.has(id))
  const opened = outermost.filter(id => expansion.has(id))
  // A boundary that stays open for its changes shows them, and its unchanged components (two or more, outside any
  // boundary of their own) as one card beside them, unless the person opened it.
  const hiddenIn = new Set(outermost.flatMap(id => [id, ...descendants(id)]))
  const rests = new Map(
    [...boundaries]
      .toSorted(compareIds)
      .filter(id => !hiddenIn.has(id))
      .map(id => [id, (children.get(id) ?? []).filter(child => !boundaries.has(child) && quiet(child)).toSorted(compareIds)] as const)
      .filter(([, members]) => members.length >= 2),
  )
  const partial = [...rests.keys()].filter(id => !expansion.has(id))
  const reopened = [...rests.keys()].filter(id => expansion.has(id))
  if (!collapsed.length && !opened.length && !rests.size) return none

  const boundary = (id: string) => shown(model.entities.find(row => row.id === id)!)
  const label = (id: string) => boundary(id).label
  const count = (id: string) => descendants(id).filter(member => !boundaries.has(member)).length
  const cards = new Map<string, BoundaryCard>()
  const cardOf = new Map<string, string>()
  const hidden = new Map<string, string>()
  const extra: EntityChange<Entity>[] = []
  for (const id of collapsed) {
    const card = `${summaryPrefix}${id}`
    for (const member of [id, ...descendants(id)]) cardOf.set(member, card)
    for (const member of descendants(id)) hidden.set(member, id)
    cards.set(card, {boundary: id, count: count(id), open: false})
    // The card stands for the boundary, so it carries the boundary's own facts (what it is for, its size).
    extra.push(unchanged({id: card, kind: 'module', label: label(id), data: {...boundary(id).data, count: count(id), collapsed: true}}))
  }
  for (const id of partial) {
    const card = `${restPrefix}${id}`
    const members = rests.get(id)!
    for (const member of members) {
      cardOf.set(member, card)
      hidden.set(member, id)
    }
    cards.set(card, {boundary: id, count: members.length, open: false, rest: true})
    extra.push(unchanged({id: card, kind: 'unchanged', label: components(members.length), data: {count: members.length, collapsed: true}}))
  }
  // A collapse card closes what the person opened: a whole boundary, or an open one's unchanged components.
  for (const [id, total] of [...opened.map(id => [id, count(id)] as const), ...reopened.map(id => [id, rests.get(id)!.length] as const)]) {
    const card = `${collapsePrefix}${id}`
    cards.set(card, {boundary: id, count: total, open: true, ...(rests.has(id) ? {rest: true} : {})})
    extra.push(unchanged({id: card, kind: 'collapse', label: `Collapse ${components(total)}`, data: {count: total, expanded: true}}))
  }

  // Relationships touching a collapsed boundary join its card: one link per pair of cards, of the first kind.
  const relationships: EntityChange<Relationship>[] = []
  const joined = new Map<string, {from: string; to: string; kinds: string[]; boundaries: Set<string>}>()
  for (const row of model.relationships) {
    const [from, to] = ends(model, row)
    const cardsAt = [from && cardOf.get(from), to && cardOf.get(to)]
    if (!cardsAt[0] && !cardsAt[1]) {
      relationships.push(row)
      continue
    }
    const source = cardsAt[0] ?? from,
      target = cardsAt[1] ?? to
    if (!source || !target || source === target) continue
    const key = `${source}->${target}`
    const entry = joined.get(key) ?? {from: source, to: target, kinds: [], boundaries: new Set<string>()}
    entry.kinds.push(shown(row).kind)
    for (const card of cardsAt) if (card) entry.boundaries.add(cards.get(card)!.boundary)
    joined.set(key, entry)
  }
  const links = new Map<string, readonly string[]>()
  for (const [key, entry] of [...joined].toSorted(([a], [b]) => compareIds(a, b))) {
    const id = `${linkPrefix}${key}`
    const kind = entry.kinds.includes('contains') ? 'contains' : entry.kinds.toSorted(compareIds)[0]!
    relationships.push(unchanged({id, kind, from: entry.from, to: entry.to, data: {count: entry.kinds.length}}))
    if (kind !== 'contains') links.set(id, [...entry.boundaries].toSorted(compareIds))
  }
  for (const id of [...opened, ...reopened]) {
    relationships.push(
      unchanged({id: `${linkPrefix}${id}->${collapsePrefix}${id}`, kind: 'contains', from: id, to: `${collapsePrefix}${id}`}),
    )
  }

  const entityRow = {before: new Map(model.entityRow.before), after: new Map(model.entityRow.after)}
  for (const row of extra) {
    entityRow.before.set(row.id, row.id)
    entityRow.after.set(row.id, row.id)
  }
  // The cards are in both revisions too, so relationships joined to them are named from their labels.
  const named = <X extends ComparisonModel['before']>(extraction: X): X => ({
    ...extraction,
    entities: [...extraction.entities, ...extra.map(row => row.after!)],
  })
  return {
    model: {
      ...model,
      before: named(model.before),
      after: named(model.after),
      entities: [...model.entities.filter(row => !cardOf.has(row.id)), ...extra],
      relationships,
      entityRow,
    },
    collapsible,
    cards,
    links,
    hidden,
  }
}

const components = (count: number) => `${count} ${count === 1 ? 'component' : 'components'}`

/** The rows a relationship row joins (its source, then its target), from whichever revision has it. */
function ends(model: ComparisonModel, row: EntityChange<Relationship>): [string | undefined, string | undefined] {
  const [relationship, rows] = row.after ? [row.after, model.entityRow.after] : [row.before!, model.entityRow.before]
  return [rows.get(relationship.from), rows.get(relationship.to)]
}

/** The rows a relationship row joins in either revision. */
function everyEnd(model: ComparisonModel, row: EntityChange<Relationship>): string[] {
  const of = (relationship: Relationship | undefined, rows: ReadonlyMap<string, string>) =>
    relationship ? [rows.get(relationship.from), rows.get(relationship.to)].filter((id): id is string => id !== undefined) : []
  return [...of(row.before, model.entityRow.before), ...of(row.after, model.entityRow.after)]
}
