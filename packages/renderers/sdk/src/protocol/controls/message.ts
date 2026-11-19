// Validating a control value a renderer sets from its own content (the `control` message).
import type {RendererMessage} from '../messages.js'
import {controlIdPattern, envelopeKeys, finite, keys} from '../validation.js'

/**
 * A `control` message: a control ID and a value any control could take (a choice's non-empty value of at most 64
 * characters, a boolean or a finite number). Whether the control exists and takes it is the host's to check.
 */
export function parseControlMessage(message: Record<string, unknown>): RendererMessage | undefined {
  if (!keys(message, [...envelopeKeys, 'id', 'value'])) return undefined
  const {id, value} = message
  if (typeof id !== 'string' || !controlIdPattern.test(id)) return undefined
  const valid = typeof value === 'boolean' || finite(value) || (typeof value === 'string' && value.length > 0 && value.length <= 64)
  return valid ? {type: 'control', id, value} : undefined
}
