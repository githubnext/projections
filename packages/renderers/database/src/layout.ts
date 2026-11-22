import {createTextSizer, type CardText, type MeasureText, type RowText, type TextChrome, type TextSizer} from './text.js'
import {columnsLayout} from './columns-layout.js'
import {schemaMetrics, type SchemaLayout, type SchemaModel} from './schema.js'
import {layerDepths} from './schema-model.js'
import {laneAssignments, stackLayout} from './stack-layout.js'

/**
 * Relationship-aware layout for `database/v0`: tables become ERD cards, ranked
 * from referenced (principal) tables on the left to dependent tables on the
 * right, with one link per foreign key drawn between the participating rows.
 * When the ranks do not fit, cards stack in one column and links run in lanes
 * along the left gutter.
 */

function rankCount(model: SchemaModel): number {
  return model.tables.length ? Math.max(...model.rank.values()) + 1 : 0
}

/**
 * Every stage's columns from one ranking over all of them: a card's rank is its
 * depth among the links of every stage, with ranks no card of a stage uses
 * closed up. So cards keep their relative columns across the comparison, and a
 * card a later stage adds or a dependency it introduces inserts a column
 * rather than reshuffling the others.
 */
function sharedRanks(models: readonly SchemaModel[]): SchemaModel[] {
  const tables = [...new Set(models.flatMap(model => model.tables))]
  const edges = new Map<string, {from: string; to: string}>()
  for (const model of models) {
    for (const link of model.links) edges.set(`${link.principal}\u0000${link.dependent}`, {from: link.principal, to: link.dependent})
  }
  const depth = layerDepths(tables, [...edges.values()])
  return models.map(model => {
    const used = [...new Set(model.tables.map(table => depth.get(table)!))].sort((a, b) => a - b)
    const dense = new Map(used.map((value, index) => [value, index]))
    return {...model, rank: new Map(model.tables.map(table => [table, dense.get(depth.get(table)!)!]))}
  })
}

/**
 * Lays out every state with the same mode and card width, so they share a
 * frame of reference. Stages are laid out from the last back to the first,
 * and each keeps the cards the next one shows in that one's order (see
 * `keepOrder`), so the same cards never swap places between Before and After.
 */
export function layoutStates(
  source: readonly SchemaModel[],
  available: number,
  links: boolean,
  measure?: MeasureText,
  chrome?: TextChrome,
  extra?: (card: string) => Pick<CardText, 'status' | 'rename'>,
): SchemaLayout[] {
  const sizer = stageSizer(source, measure, chrome, extra)
  const {rankGap, minCard, maxCard, maxStackedCard, maxContentCard, lane, gutterPad} = schemaMetrics
  const models = sharedRanks(source)
  // Cards are as wide as their widest text needs on one line (never narrower than the usual card, never wider than
  // maxContentCard), when the frame has room; with less, text wraps and rows grow.
  const need = Math.max(
    0,
    ...[...new Set(models.flatMap(model => model.tables))].map(card =>
      sizer.cardNeed(card, [...new Set(models.flatMap(model => model.columns.get(card) ?? []))]),
    ),
  )
  const ranks = Math.max(1, ...models.map(rankCount))
  const backwards = (layout: (model: SchemaModel, later: ReadonlyMap<string, number> | undefined) => SchemaLayout) => {
    const result: SchemaLayout[] = []
    let later: Map<string, number> | undefined
    for (let index = models.length - 1; index >= 0; index--) {
      const placed = layout(models[index]!, later)
      result[index] = placed
      later = new Map([...placed.tables].map(([id, box]) => [id, box.y]))
    }
    return result
  }
  if (ranks * minCard + (ranks - 1) * rankGap <= available) {
    const share = Math.floor((available - (ranks - 1) * rankGap) / ranks)
    const cardWidth = Math.min(share, Math.max(maxCard, Math.min(need, maxContentCard)))
    return backwards((model, later) => columnsLayout(model, cardWidth, sizer, later))
  }
  const laneCount = !links
    ? 0
    : Math.max(0, ...models.flatMap(model => [...laneAssignments(model, maxStackedCard, sizer).values()].map(index => index + 1)))
  const gutter = laneCount ? gutterPad + laneCount * lane : 0
  const cardWidth = Math.max(minCard, Math.min(Math.max(maxStackedCard, Math.min(need, maxContentCard)), Math.floor(available - gutter)))
  return backwards((model, later) => stackLayout(model, cardWidth, gutter, sizer, later))
}

/** Sizes cards and rows from what every stage shows, so a card or row fits each version it has. */
function stageSizer(
  models: readonly SchemaModel[],
  measure?: MeasureText,
  chrome?: TextChrome,
  extra?: (card: string) => Pick<CardText, 'status' | 'rename'>,
): TextSizer {
  const cards = new Map<string, CardText[]>()
  const rows = new Map<string, RowText[]>()
  const add = <T>(map: Map<string, T[]>, id: string, value: T) => map.set(id, [...(map.get(id) ?? []), value])
  for (const model of models) for (const [id, text] of model.texts.cards) add(cards, id, {...text, ...extra?.(id)})
  for (const model of models) for (const [id, text] of model.texts.rows) add(rows, id, text)
  return createTextSizer(
    id => cards.get(id) ?? [],
    id => rows.get(id) ?? [],
    measure,
    chrome,
  )
}
