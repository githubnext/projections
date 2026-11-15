// Cards in one layer share its depth, so every layer reads as one band.
import type {GraphLayout} from '../layout.js'

/**
 * The cards of `layout` shallower than the deepest card of their layer, with that depth: its height when the layers
 * run top to bottom, its width when they run left to right. Cards in a layer start together, so with these depths they
 * end together too, and the layers read as rows (or columns) rather than ragged lines. A layout with boundaries keeps
 * its own sizes. A transition takes the depths from one layout, so no card resizes while scrubbing.
 */
export function layerBands(layout: GraphLayout, orientation: 'vertical' | 'horizontal'): Map<string, number> {
  const bands = new Map<string, number>()
  if (layout.groups.size) return bands
  const flow = orientation === 'horizontal' ? 'x' : 'y'
  const depth = orientation === 'horizontal' ? 'width' : 'height'
  const cards = [...layout.points]
    .map(([id, point]) => {
      const size = layout.sizes.get(id)!
      return {id, start: point[flow] - size[depth] / 2, depth: size[depth]}
    })
    .sort((a, b) => a.start - b.start)
  const layers: (typeof cards)[] = []
  for (const card of cards) {
    const layer = layers.at(-1)
    if (layer && card.start - layer[0]!.start < 1) layer.push(card)
    else layers.push([card])
  }
  for (const layer of layers) {
    const deepest = Math.max(...layer.map(card => card.depth))
    for (const card of layer) if (card.depth < deepest - 0.5) bands.set(card.id, deepest)
  }
  return bands
}
