// Validating the host's answer to a renderer's `document-request`.
import {rendererLimits} from './frame.js'
import type {HostMessage} from './messages.js'
import {envelopeKeys, keys, rendererNamePattern} from './validation.js'

/** A `document`: a built-in renderer's name and either its `html` or the host's `error`, nothing else. */
export function document(message: Record<string, unknown>): HostMessage | undefined {
  if (!keys(message, [...envelopeKeys, 'renderer', 'html', 'error'])) return undefined
  const {renderer, html, error} = message
  if (typeof renderer !== 'string' || !rendererNamePattern.test(renderer)) return undefined
  if (typeof html === 'string' && error === undefined) return {type: 'document', renderer, html}
  if (typeof error === 'string' && error.length <= rendererLimits.textLength && html === undefined)
    return {type: 'document', renderer, error}
  return undefined
}
