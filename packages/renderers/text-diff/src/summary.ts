import type {ComparisonModel, SummaryFactContext, SummaryFactItem, SummaryNouns} from '@githubnext/projections-renderer-kit'
import type {Entity} from '@githubnext/projections-schemas'
import {diffLines, splitLines} from './diff.js'

/** The summary bar's word for each entity: a captured output. */
export const textDiffNouns: SummaryNouns = {output: {singular: 'output', plural: 'outputs'}}

interface LineCount {
  count: number
  added: number
  removed: number
}

const counted = new WeakMap<ComparisonModel, LineCount>()

/** An output's text, or none for an entity the view refuses (it reports why). */
const textOf = (entity: Entity | undefined) => (typeof entity?.data?.text === 'string' ? entity.data.text : undefined)

function countLines(model: ComparisonModel, comparing: boolean): LineCount {
  const total: LineCount = {count: 0, added: 0, removed: 0}
  for (const row of model.entities) {
    const before = comparing ? textOf(row.before) : undefined
    const after = textOf(row.after)
    if (!comparing || before === after) {
      total.count += after === undefined ? 0 : splitLines(after).length
      continue
    }
    const diff = diffLines(before ?? '', after ?? '')
    total.count += diff.after.length
    for (const op of diff.ops) {
      if (op.kind === 'insert') total.added++
      else if (op.kind === 'delete') total.removed++
    }
  }
  return total
}

/**
 * The summary bar's line count: every output's lines in After, with the lines the diff inserts and deletes across all
 * of them in a comparison (`57 lines +9 −5`), as the diff marks them: an added output's lines are all inserted and a
 * removed one's all deleted. The line diff is the view's, so the figures match its marks.
 */
export function textDiffFacts({init, model}: SummaryFactContext): SummaryFactItem[] {
  const comparing = init.mode === 'comparison'
  const lines = counted.get(model) ?? counted.set(model, countLines(model, comparing)).get(model)!
  return [
    {
      type: 'fact',
      id: 'lines',
      count: lines.count,
      noun: {singular: 'line', plural: 'lines'},
      ...(comparing && lines.added ? {added: lines.added} : {}),
      ...(comparing && lines.removed ? {removed: lines.removed} : {}),
    },
  ]
}
