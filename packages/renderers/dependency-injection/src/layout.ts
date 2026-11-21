import {compareIds} from '@githubnext/projections-renderer-kit'
import {diMetrics} from './geometry.js'
import type {DiModel} from './model.js'

/** Longest-path layer of every node from the roots, ignoring cycles. */
export function layerDepths(nodes: string[], edges: {from: string; to: string}[]): Map<string, number> {
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
  // The queue grows as it is read: an array's iterator reaches the items pushed during the loop.
  for (const id of queue) {
    for (const child of outgoing.get(id) ?? []) {
      depth.set(child, Math.max(depth.get(child) ?? 0, (depth.get(id) ?? 0) + 1))
      incoming.set(child, incoming.get(child)! - 1)
      if (incoming.get(child) === 0) queue.push(child)
    }
  }
  for (const id of nodes) if (!depth.has(id)) depth.set(id, 0)
  return depth
}

export interface DiPosition {
  x: number
  y: number
  depth: number
}

/**
 * Layered composition layout: roots are the entry points nothing injects, and
 * each unit sits below the units that construct it. Sibling order is settled by
 * barycenter passes so shared dependencies do not drag crossings through the
 * whole graph, and parents are then centered over what they compose. Rows are `height` apart, and a row gap.
 */
export function layoutDiModel(model: DiModel, height: number = diMetrics.height): Map<string, DiPosition> {
  const ids = model.units.map(unit => unit.id)
  const present = new Set(ids)
  const links = model.links.filter(link => present.has(link.from) && present.has(link.to))
  const depths = layerDepths(ids, links)
  const children = new Map(ids.map(id => [id, [] as string[]]))
  const parents = new Map(ids.map(id => [id, [] as string[]]))
  for (const link of links) {
    if (depths.get(link.to)! <= depths.get(link.from)!) continue
    children.get(link.from)!.push(link.to)
    parents.get(link.to)!.push(link.from)
  }

  const order = new Map<string, number>()
  const stack = ids
    .filter(id => (parents.get(id)?.length ?? 0) === 0)
    .sort(compareIds)
    .reverse()
  const visited = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    order.set(id, order.size)
    for (const child of [...children.get(id)!].sort(compareIds).reverse()) stack.push(child)
  }
  for (const id of [...ids].sort(compareIds)) if (!order.has(id)) order.set(id, order.size)

  const layers: string[][] = []
  for (const id of [...ids].sort((a, b) => order.get(a)! - order.get(b)!)) {
    const depth = depths.get(id) ?? 0
    ;(layers[depth] ??= []).push(id)
  }
  for (let layer = 0; layer < layers.length; layer++) layers[layer] ??= []

  const indexOf = () => {
    const index = new Map<string, number>()
    for (const layer of layers) layer.forEach((id, position) => index.set(id, position))
    return index
  }
  const barycenter = (id: string, related: Map<string, string[]>, index: Map<string, number>) => {
    const neighbors = related.get(id)!.filter(neighbor => index.has(neighbor))
    if (!neighbors.length) return Number.POSITIVE_INFINITY
    return neighbors.reduce((sum, neighbor) => sum + index.get(neighbor)!, 0) / neighbors.length
  }
  // Infinity minus Infinity is NaN, which a comparator must never return.
  const byBarycenter = (left: number, right: number) => (left === right ? 0 : left - right)
  for (let pass = 0; pass < 2; pass++) {
    let index = indexOf()
    for (let depth = 1; depth < layers.length; depth++) {
      layers[depth]!.sort(
        (a, b) => byBarycenter(barycenter(a, parents, index), barycenter(b, parents, index)) || order.get(a)! - order.get(b)!,
      )
    }
    index = indexOf()
    for (let depth = layers.length - 2; depth >= 0; depth--) {
      layers[depth]!.sort(
        (a, b) => byBarycenter(barycenter(a, children, index), barycenter(b, children, index)) || order.get(a)! - order.get(b)!,
      )
    }
  }

  const step = diMetrics.width + diMetrics.columnGap
  const positions = new Map<string, DiPosition>()
  for (const [depth, layer] of layers.entries()) {
    layer.forEach((id, position) =>
      positions.set(id, {
        x: (position - (layer.length - 1) / 2) * step,
        y: depth * (height + diMetrics.rowGap),
        depth,
      }),
    )
  }
  for (let depth = layers.length - 2; depth >= 0; depth--) {
    const layer = layers[depth]!
    const desired = layer.map(id => {
      const below = children.get(id)!.filter(child => positions.has(child))
      return below.length ? below.reduce((sum, child) => sum + positions.get(child)!.x, 0) / below.length : positions.get(id)!.x
    })
    let previous = Number.NEGATIVE_INFINITY
    layer.forEach((id, position) => {
      const x = Math.max(desired[position]!, previous + step)
      positions.get(id)!.x = x
      previous = x
    })
    const shift = layer.length ? (positions.get(layer[0]!)!.x + positions.get(layer.at(-1)!)!.x) / 2 : 0
    for (const id of layer) positions.get(id)!.x -= shift
  }
  return positions
}
