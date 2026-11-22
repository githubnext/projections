import {createNativeEngine} from '@githubnext/projections-engine/native'

/** Real default comparator, so tests see the same steps a host would send. */
export const engine = createNativeEngine()

export const extraction = (schema, entities, relationships = []) => ({protocolVersion: 0, schema, entities, relationships})
export const entity = (id, kind = 'package', extra = {}) => ({id, kind, label: id, ...extra})
export const relationship = (id, from, to, kind = 'dependency') => ({id, kind, from, to})

export async function compare(before, after, options) {
  return engine.compare(before, after, options)
}

/**
 * Card widths as `GraphCanvas` sizes them: the one width the graph's longest card text needs with the default kind
 * lines (`graphCardsWidth`), for a layout's entities or a comparison model's rows (with room for their status in a
 * comparison).
 */
export async function cardWidths(rows, comparing = false) {
  const {graphCardsWidth} = await import('../dist/index.js')
  const width = graphCardsWidth(
    rows.map(row => ('label' in row ? {after: row} : row)),
    {comparing},
  )
  return new Map(rows.map(row => [row.id, width]))
}

/** Layout nodes of `entities`, as wide as the graph's text needs. */
export async function sizedNodes(entities) {
  const widths = await cardWidths(entities)
  return entities.map(node => ({...node, width: widths.get(node.id)}))
}
