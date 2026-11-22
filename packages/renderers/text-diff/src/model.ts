import type {Entity, Extraction} from '@githubnext/projections-schemas'
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'

export type TextPresentation = 'prose' | 'formatted'
export type TextDiffLayout = 'split' | 'unified'

export interface Output {
  id: string
  label: string
  text: string
  presentation: TextPresentation
}

/** Rows rendered per output; longer texts show a notice. */
export const lineLimit = 2000

/** Reads one output entity, rejecting anything that isn't `kind: 'output'` with string `data.text`. */
export function readOutput(entity: Entity): Output {
  if (entity.kind !== 'output') throw new Error(`Text diff entity "${entity.id}" must have kind "output", not "${entity.kind}"`)
  const text = entity.data?.text
  if (typeof text !== 'string') throw new TypeError(`Text diff output "${entity.id}" must contain string data.text`)
  const presentation = entity.data?.presentation ?? 'formatted'
  if (presentation !== 'prose' && presentation !== 'formatted') {
    throw new Error(`Text diff output "${entity.id}" has invalid data.presentation: expected "prose" or "formatted"`)
  }
  return {id: entity.id, label: entity.label || entity.id, text, presentation}
}

function checkExtraction(extraction: Extraction): void {
  if (extraction.schema !== 'graph/v0') throw new Error(`Text diff requires graph/v0 extractions, not ${extraction.schema}`)
  if (extraction.relationships.length) throw new Error('Text diff does not support relationships between outputs')
  for (const entity of extraction.entities) readOutput(entity)
}

/** Validates both extractions; throws a message a reader can act on. */
export function validateModel(model: ComparisonModel): void {
  checkExtraction(model.before)
  if (model.after !== model.before) checkExtraction(model.after)
}
