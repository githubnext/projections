// The hierarchy a snapshot packs: each active row's parent, and the tree of circles to draw down to the depth limit.
import type {Entity} from '@githubnext/projections-schemas'
import {compareIds} from '@githubnext/projections-renderer-kit'

/** One state of the hierarchy to pack: the rows present, the version each shows, and its containment links. */
export interface Snapshot {
  active: ReadonlySet<string>
  entity: (id: string) => Entity
  /** Parent to child links between active rows. */
  links: readonly {from: string; to: string}[]
}

export interface PackSettings {
  /** A leaf's weight (bytes, lines or value). */
  weight: (entity: Entity) => number
  /** A leaf's color category. */
  category: (entity: Entity) => string
  /** Deepest level drawn (top-level items are depth 1); deeper folders become one filled circle. */
  maxDepth: number
}

export interface TreeNode {
  id: string
  value: number
  category?: string
  filled: boolean
  children?: TreeNode[]
}

/** Parent of each active row from its links: the first link to it, in ID order, that closes no cycle. */
function parents(snapshot: Snapshot): Map<string, string> {
  const parent = new Map<string, string>()
  const links = [...snapshot.links].sort((a, b) => compareIds(a.to, b.to) || compareIds(a.from, b.from))
  for (const {from, to} of links) {
    if (from === to || parent.has(to) || !snapshot.active.has(from) || !snapshot.active.has(to)) continue
    let cursor: string | undefined = from
    while (cursor !== undefined && cursor !== to) cursor = parent.get(cursor)
    if (cursor === to) continue
    parent.set(to, from)
  }
  return parent
}

export function tree(snapshot: Snapshot, settings: PackSettings): {tops: TreeNode[]; root?: string} {
  const parent = parents(snapshot)
  const children = new Map<string, string[]>()
  for (const [child, of] of parent) (children.get(of) ?? children.set(of, []).get(of)!).push(child)
  for (const list of children.values()) list.sort(compareIds)
  const roots = [...snapshot.active].filter(id => !parent.has(id)).sort(compareIds)
  const sole = roots.length === 1 && children.get(roots[0]!)?.length ? roots[0] : undefined
  // A folder at the depth limit is drawn as one circle: its weight and its heaviest category.
  const collapse = (id: string, totals: Map<string, number>): number => {
    const kids = children.get(id)
    if (!kids?.length) {
      const entity = snapshot.entity(id)
      const weight = settings.weight(entity)
      const category = settings.category(entity)
      totals.set(category, (totals.get(category) ?? 0) + weight)
      return weight
    }
    return kids.reduce((sum, kid) => sum + collapse(kid, totals), 0)
  }
  const build = (id: string, depth: number): TreeNode => {
    const kids = children.get(id)
    if (kids?.length && depth < settings.maxDepth) return {id, value: 0, filled: false, children: kids.map(kid => build(kid, depth + 1))}
    if (kids?.length) {
      const totals = new Map<string, number>()
      // A weighted hierarchy's explicit internal weight is authoritative where the folder is drawn as one circle.
      const declared = settings.weight(snapshot.entity(id))
      const counted = collapse(id, totals)
      const value = declared > 0 ? declared : counted
      const category = [...totals].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0]
      return {id, value, filled: true, ...(category === undefined ? {} : {category})}
    }
    const entity = snapshot.entity(id)
    return {id, value: settings.weight(entity), category: settings.category(entity), filled: true}
  }
  const tops = (sole ? children.get(sole)! : roots).map(id => build(id, 1))
  return sole ? {tops, root: sole} : {tops}
}
