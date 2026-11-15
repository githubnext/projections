// Narrowing a frame to the viewer's search and filters, and reading it.
import type {Entity, Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from './changes.js'
import type {PresentationFrame} from './frame.js'
import {unit} from './progress.js'
import type {ViewerState} from './viewer.js'

/**
 * Whether a row passes the viewer's filters: its `status` equals `state.status` (unless `all`), either version has
 * `state.kind` (unless empty), and either version's ID, label, kind or JSON `data` contains the trimmed `state.search`,
 * ignoring case (an empty search matches).
 */
export function matchesFilter(
  change: EntityChange<Entity | Relationship>,
  state: Pick<ViewerState, 'search' | 'kind' | 'status'>,
): boolean {
  if (state.status !== 'all' && change.status !== state.status) return false
  const entities = [change.before, change.after].filter((entity): entity is Entity | Relationship => Boolean(entity))
  if (state.kind && !entities.some(entity => entity.kind === state.kind)) return false
  const query = state.search.trim().toLocaleLowerCase()
  return (
    !query ||
    entities.some(entity =>
      `${entity.id} ${entity.label ?? ''} ${entity.kind} ${JSON.stringify(entity.data ?? {})}`.toLocaleLowerCase().includes(query),
    )
  )
}

/**
 * `frame` narrowed to the rows `matchesFilter` keeps. A matching relationship brings its endpoints along, so it is
 * never drawn dangling; a relationship that doesn't match stays when both its endpoints are kept. Other fields are
 * unchanged.
 */
export function filterFrame(frame: PresentationFrame, state: Pick<ViewerState, 'search' | 'kind' | 'status'>): PresentationFrame {
  const nodes = frame.nodes.filter(node => matchesFilter(node.change, state))
  const ids = new Set(nodes.map(node => node.id))
  const edges = frame.edges.filter(edge => {
    const matches = matchesFilter(edge.change, state)
    if (matches) {
      for (const id of [edge.from, edge.to]) {
        if (ids.has(id)) continue
        const node = frame.nodes.find(candidate => candidate.id === id)
        if (node) {
          nodes.push(node)
          ids.add(id)
        }
      }
    }
    return matches || (ids.has(edge.from) && ids.has(edge.to))
  })
  return {...frame, nodes, edges}
}

/**
 * The numeric `data[key]` of an entity at `progress`: linear from the `before` value (at 0) to the `after` value (at
 * 1) when both are numbers, else whichever side is a number (`after` first), else `undefined`.
 *
 * @throws `RangeError` when both are numbers and `progress` isn't finite.
 */
export function interpolatedNumber(change: EntityChange<Entity>, key: string, progress: number): number | undefined {
  const a = change.before?.data?.[key]
  const b = change.after?.data?.[key]
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * unit(progress)
  return typeof b === 'number' ? b : typeof a === 'number' ? a : undefined
}

/**
 * The IDs of `frame.nodes` still shown when the items in `collapsed` are collapsed: every node except the descendants
 * of a collapsed one, following edges from `from` to `to` (cycles are safe). Collapsed nodes themselves stay visible.
 */
export function visibleHierarchy(frame: PresentationFrame, collapsed: ReadonlySet<string>): Set<string> {
  const children = new Map<string, string[]>()
  for (const edge of frame.edges) {
    const list = children.get(edge.from) ?? []
    list.push(edge.to)
    children.set(edge.from, list)
  }
  const hidden = new Set<string>()
  const stack = [...collapsed].flatMap(id => children.get(id) ?? [])
  while (stack.length) {
    const id = stack.pop()!
    if (hidden.has(id)) continue
    hidden.add(id)
    stack.push(...(children.get(id) ?? []))
  }
  return new Set(frame.nodes.map(node => node.id).filter(id => !hidden.has(id)))
}
