import type {Definition} from '@githubnext/projections-schemas'
import {identifier, object} from './fields.js'
import {parseJson} from './parse.js'

/**
 * The definition the runner already validated against the definition schema.
 * The helper checks only what it reads, `id` and `inputs`, so it never rejects a
 * field the schema allows (as a second, hand-kept copy of the schema would when
 * the schema grows).
 */
export function validateDefinition(value: unknown): Definition {
  const config = object(value, 'Projection definition')
  identifier(config.id, 'projection.id')
  if (config.inputs !== undefined) {
    // Round-tripping through the bounded strict JSON reader rejects non-JSON API inputs too.
    object(parseJson(JSON.stringify(config.inputs)), 'inputs')
  }
  return config as unknown as Definition
}
