// Validating what a renderer sends its host.
import {parseCapabilities} from './capabilities.js'
import {parseControls} from './controls/declaration.js'
import {parseControlMessage} from './controls/message.js'
import {rendererLimits} from './frame.js'
import {parseLegend} from './legend.js'
import type {RendererMessage} from './messages.js'
import {anchorRect, scrollPosition} from './positions.js'
import {steps} from './steps-message.js'
import {parseSummaryItems} from './summary/items.js'
import {envelopeKeys, finite, isEnvelope, isPropertyPath, keys, rendererNamePattern, text} from './validation.js'

type Fields = Record<string, unknown>

/** A selection ID, or `null` for none. */
const selectionId = (id: unknown): id is string | null => id === null || (text(id) && id.length > 0)

function select(message: Fields): RendererMessage | undefined {
  if (!keys(message, [...envelopeKeys, 'id', 'path']) || !selectionId(message.id)) return undefined
  if (message.path !== undefined && (message.id === null || !isPropertyPath(message.path))) return undefined
  return {type: 'select', id: message.id, ...(message.path === undefined ? {} : {path: message.path as string})}
}

function open(message: Fields): RendererMessage | undefined {
  if (!keys(message, [...envelopeKeys, 'path', 'line']) || !text(message.path) || !message.path) return undefined
  if (message.line !== undefined && !(Number.isSafeInteger(message.line) && (message.line as number) > 0)) return undefined
  return {type: 'open', path: message.path, ...(message.line === undefined ? {} : {line: message.line as number})}
}

function anchor(message: Fields): RendererMessage | undefined {
  if (!keys(message, [...envelopeKeys, 'id', 'rect']) || !text(message.id) || !message.id) return undefined
  if (message.rect === null) return {type: 'anchor', id: message.id, rect: null}
  const rect = anchorRect(message.rect)
  return rect ? {type: 'anchor', id: message.id, rect} : undefined
}

/** The parser of each message a renderer may send, by type. */
const parsers: {[type: string]: (message: Fields) => RendererMessage | undefined} = {
  ready(message) {
    if (!keys(message, [...envelopeKeys, 'capabilities'])) return undefined
    const capabilities = parseCapabilities(message.capabilities)
    return capabilities ? {type: 'ready', capabilities} : undefined
  },
  rendered(message) {
    if (!keys(message, [...envelopeKeys, 'progress']) || !finite(message.progress) || message.progress < 0 || message.progress > 1)
      return undefined
    return {type: 'rendered', progress: message.progress}
  },
  select,
  annotation(message) {
    if (!keys(message, [...envelopeKeys, 'id']) || !text(message.id) || !message.id) return undefined
    return {type: 'annotation', id: message.id}
  },
  legend(message) {
    const legend = parseLegend(message, envelopeKeys)
    return legend ? {type: 'legend', ...legend} : undefined
  },
  summary(message) {
    if (!keys(message, [...envelopeKeys, 'items'])) return undefined
    const items = parseSummaryItems(message.items)
    return items ? {type: 'summary', items} : undefined
  },
  height(message) {
    if (!keys(message, [...envelopeKeys, 'px']) || !finite(message.px) || message.px < 0) return undefined
    return {type: 'height', px: message.px}
  },
  aspect(message) {
    if (!keys(message, [...envelopeKeys, 'ratio']) || !finite(message.ratio)) return undefined
    if (message.ratio < rendererLimits.aspect.min || message.ratio > rendererLimits.aspect.max) return undefined
    return {type: 'aspect', ratio: message.ratio}
  },
  steps,
  open,
  error(message) {
    if (!keys(message, [...envelopeKeys, 'message']) || typeof message.message !== 'string') return undefined
    return {type: 'error', message: message.message.slice(0, rendererLimits.textLength)}
  },
  hover(message) {
    if (!keys(message, [...envelopeKeys, 'id']) || !selectionId(message.id)) return undefined
    return {type: 'hover', id: message.id}
  },
  anchor,
  viewport(message) {
    const position = scrollPosition(message, [...envelopeKeys])
    return position ? {type: 'viewport', ...position} : undefined
  },
  controls(message) {
    if (!keys(message, [...envelopeKeys, 'controls'])) return undefined
    const controls = parseControls(message.controls)
    return controls ? {type: 'controls', controls} : undefined
  },
  control: parseControlMessage,
  'document-request'(message) {
    if (!keys(message, [...envelopeKeys, 'renderer'])) return undefined
    const {renderer} = message
    return typeof renderer === 'string' && rendererNamePattern.test(renderer) ? {type: 'document-request', renderer} : undefined
  },
}

/**
 * Validates a renderer-to-host message strictly. Returns `undefined` for
 * anything that is not exactly one of the protocol messages, including
 * unknown fields, out-of-range numbers and oversized text.
 */
export function parseRendererMessage(value: unknown, channel: string): RendererMessage | undefined {
  if (!isEnvelope(value, channel)) return undefined
  const message = value as unknown as Record<string, unknown>
  const parse = typeof message.type === 'string' && Object.hasOwn(parsers, message.type) ? parsers[message.type] : undefined
  return parse?.(message)
}
