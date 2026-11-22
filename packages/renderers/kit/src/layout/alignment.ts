/**
 * Telling which Brandes–Köpf alignment ELK chose, without laying the graph out again.
 *
 * ELK's Brandes–Köpf placement aligns each node with a median neighbour in the
 * layer before it or after it, scanning each layer from its start or its end,
 * and places every aligned block in one column: with a port in the middle of
 * each face, a relationship whose nodes share a block runs straight. Running
 * that vertical alignment on a layout's layers and order predicts, for each of
 * the four alignments, which relationships come out straight.
 */

/** A Brandes–Köpf alignment: one of the four, or their balanced average. */
export type Alignment = 'BALANCED' | (typeof alignments)[number]
/** The four Brandes–Köpf alignments, each of which keeps whole chains of nodes in columns. */
export const alignments = ['LEFTUP', 'RIGHTUP', 'LEFTDOWN', 'RIGHTDOWN'] as const

/** A node of a layered layout: its layer and its place across it (any coordinate in layer order). */
export interface LayeredNode {
  layer: number
  across: number
}

/** A relationship: its ends, and where it crosses each layer between them, in order (ELK's long-edge dummies). */
export interface LayeredEdge {
  from: string
  to: string
  /** Across coordinates in the layers strictly between `from`'s and `to`'s. */
  through: readonly number[]
}

interface Vertex {
  id: number
  layer: number
  across: number
  /** A long relationship's place in a layer it passes through. */
  dummy: boolean
  upper: Vertex[]
  lower: Vertex[]
  position: number
}

/**
 * Which of the four alignments placed a layout: the one whose blocks best match the relationships that came out
 * straight (`straight`, indexes into `edges`). ELK's `NONE` placement keeps the narrowest of the four without saying
 * which; a transition's steps take that one, so they place their cards as the union did.
 */
export function identifyAlignment(
  nodes: ReadonlyMap<string, LayeredNode>,
  edges: readonly LayeredEdge[],
  straight: ReadonlySet<number>,
): Exclude<Alignment, 'BALANCED'> {
  const vertices: Vertex[] = []
  const vertex = (layer: number, across: number, dummy: boolean) => {
    const made: Vertex = {id: vertices.length, layer, across, dummy, upper: [], lower: [], position: 0}
    vertices.push(made)
    return made
  }
  const real = new Map([...nodes].map(([id, node]) => [id, vertex(node.layer, node.across, false)] as const))
  const chains: {index: number; chain: Vertex[]}[] = []
  for (const [index, edge] of edges.entries()) {
    const from = real.get(edge.from),
      to = real.get(edge.to)
    if (!from || !to || from.layer >= to.layer) continue
    const chain = [from]
    for (let layer = from.layer + 1; layer < to.layer; layer++) {
      chain.push(vertex(layer, edge.through[layer - from.layer - 1] ?? (from.across + to.across) / 2, true))
    }
    chain.push(to)
    for (let position = 1; position < chain.length; position++) {
      chain[position]!.upper.push(chain[position - 1]!)
      chain[position - 1]!.lower.push(chain[position]!)
    }
    chains.push({index, chain})
  }
  // Sparse: a layer no vertex is in is a hole.
  const layers: (Vertex[] | undefined)[] = []
  for (const item of vertices) (layers[item.layer] ??= []).push(item)
  for (const layer of layers) {
    if (!layer) continue
    layer.sort((a, b) => a.across - b.across || a.id - b.id)
    layer.forEach((item, index) => {
      item.position = index
    })
  }
  for (const item of vertices) {
    item.upper.sort((a, b) => a.position - b.position)
    item.lower.sort((a, b) => a.position - b.position)
  }
  const marked = typeOneConflicts(layers)
  let best: {alignment: Exclude<Alignment, 'BALANCED'>; score: number} | undefined
  for (const alignment of alignments) {
    // ELK names directions in its own left-to-right frame: horizontal `RIGHT` aligns with the layer before, `LEFT`
    // with the layer after; vertical `DOWN` scans each layer from its start, `UP` from its end.
    const root = verticalAlignment(layers, marked, alignment.startsWith('RIGHT'), alignment.endsWith('DOWN'))
    let score = 0
    for (const {index, chain} of chains) {
      const predicted = chain.every(item => root[item.id] === root[chain[0]!.id])
      if (predicted === straight.has(index)) score++
    }
    if (!best || score > best.score) best = {alignment, score}
  }
  return best?.alignment ?? alignments[0]
}

/**
 * Segments that cross an inner segment (one between two dummies) and so never align: Brandes–Köpf keeps long
 * relationships straight first. Keys are `upper,lower` vertex IDs.
 */
function typeOneConflicts(layers: readonly (Vertex[] | undefined)[]): Set<string> {
  const marked = new Set<string>()
  for (let index = 1; index + 1 < layers.length; index++) {
    const upper = layers[index],
      lower = layers[index + 1]
    if (!upper || !lower) continue
    let k0 = 0,
      scanned = 0
    for (let l1 = 0; l1 < lower.length; l1++) {
      const v = lower[l1]!
      const inner = v.dummy ? v.upper.find(u => u.dummy) : undefined
      if (l1 !== lower.length - 1 && !inner) continue
      const k1 = inner ? inner.position : upper.length - 1
      for (; scanned <= l1; scanned++) {
        const w = lower[scanned]!
        for (const u of w.upper) if (u.position < k0 || u.position > k1) marked.add(`${u.id},${w.id}`)
      }
      k0 = k1
    }
  }
  return marked
}

/**
 * Brandes–Köpf's vertical alignment: each vertex's block root, aligning with medians in the layer before (`up`) or
 * after, scanning each layer from its start (`left`) or its end.
 */
function verticalAlignment(layers: readonly (Vertex[] | undefined)[], marked: ReadonlySet<string>, up: boolean, left: boolean): number[] {
  const count = layers.reduce((sum, layer) => sum + (layer?.length ?? 0), 0)
  const root = Array.from({length: count}, (_, index) => index)
  const align = Array.from({length: count}, (_, index) => index)
  const order = up ? [...layers.keys()] : [...layers.keys()].reverse()
  for (const index of order.slice(1)) {
    const layer = layers[index]
    if (!layer) continue
    let r = left ? -1 : Infinity
    for (const v of left ? layer : [...layer].reverse()) {
      const neighbours = up ? v.upper : v.lower
      if (!neighbours.length) continue
      const d = neighbours.length
      const medians = [...new Set([Math.floor((d - 1) / 2), Math.ceil((d - 1) / 2)])]
      for (const m of left ? medians : medians.reverse()) {
        if (align[v.id] !== v.id) continue
        const u = neighbours[m]!
        const conflict = up ? marked.has(`${u.id},${v.id}`) : marked.has(`${v.id},${u.id}`)
        if (!conflict && (left ? r < u.position : r > u.position)) {
          align[u.id] = v.id
          root[v.id] = root[u.id]!
          align[v.id] = root[v.id]!
          r = u.position
        }
      }
    }
  }
  return root
}
