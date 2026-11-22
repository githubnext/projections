// Validating what a host sends its renderers.
import {parseAnnotations} from './annotation-marks.js'
import {comparisonModes} from './comparison-modes.js'
import type {ComparisonMode} from './comparison-modes.js'
import type {RendererTheme} from './frame.js'
import {focus, parseKinds} from './init-fields.js'
import {environment} from './environment.js'
import type {HostMessage, RendererOptions} from './messages.js'
import {scrollPosition} from './positions.js'
import {controlIdPattern, envelopeKeys, finite, isEnvelope, isPropertyPath, record, isGeneration} from './validation.js'
import {document} from './document-message.js'
import {filter} from './filter-message.js'

type Fields = Record<string, unknown>

// The engine normalizes missing `data` to `{}`; renderers receive the same.
function withData(extraction: Record<string, unknown>): Record<string, unknown> {
  const fill = (items: unknown) =>
    Array.isArray(items) ? items.map(item => (record(item) && item.data === undefined ? {...item, data: {}} : item)) : items
  return {...extraction, entities: fill(extraction.entities), relationships: fill(extraction.relationships)}
}

function init(message: Fields): HostMessage | undefined {
  const {projection: raw} = message
  if (
    !environment(message) ||
    !focus(message.focus) ||
    !record(raw) ||
    typeof raw.id !== 'string' ||
    typeof raw.title !== 'string' ||
    typeof raw.renderer !== 'string'
  ) {
    return undefined
  }
  // Kinds are presentation hints: malformed entries are dropped rather than refusing the document.
  const {kinds: rawKinds, ...rest} = raw as Fields
  const kinds = parseKinds(rawKinds)
  const projection = {...rest, ...(kinds ? {kinds} : {})}
  if (message.generation !== undefined && !isGeneration(message.generation)) return undefined
  const {projections: _projections, channel: _channel, ...fields} = message
  const payload = {...fields, projection}
  if (message.mode === 'extraction' && record(message.extraction)) {
    return {...payload, extraction: withData(message.extraction)} as unknown as HostMessage
  }
  if (
    message.mode === 'comparison' &&
    record(message.before) &&
    record(message.after) &&
    record(message.comparison) &&
    (message.comparisonMode === undefined || comparisonModes.includes(message.comparisonMode as ComparisonMode))
  ) {
    return {...payload, before: withData(message.before), after: withData(message.after)} as unknown as HostMessage
  }
  return undefined
}

/** The parser of each message a host may send, by type. */
const parsers: Record<string, (message: Fields) => HostMessage | undefined> = {
  init,
  progress(message) {
    if (!finite(message.progress) || !finite(message.highlighting) || (message.direction !== 1 && message.direction !== -1)) {
      return undefined
    }
    return {type: 'progress', progress: message.progress, highlighting: message.highlighting, direction: message.direction}
  },
  select(message) {
    if (message.id !== null && typeof message.id !== 'string') return undefined
    if (message.path !== undefined && (message.id === null || !isPropertyPath(message.path))) return undefined
    return {type: 'select', id: message.id, ...(message.path === undefined ? {} : {path: message.path})}
  },
  annotations: parseAnnotations,
  options(message) {
    if (!record(message.options)) return undefined
    return {type: 'options', options: message.options}
  },
  viewport(message) {
    if (!finite(message.width) || !finite(message.height)) return undefined
    return {type: 'viewport', width: message.width, height: message.height}
  },
  hover(message) {
    if (message.id !== null && typeof message.id !== 'string') return undefined
    return {type: 'hover', id: message.id}
  },
  scroll(message) {
    const position = scrollPosition(message, [...envelopeKeys])
    return position ? {type: 'scroll', ...position} : undefined
  },
  action(message) {
    if (typeof message.id !== 'string' || !controlIdPattern.test(message.id)) return undefined
    return {type: 'action', id: message.id}
  },
  filter,
  document,
  environment(message) {
    if (!environment(message)) return undefined
    return {
      type: 'environment',
      theme: message.theme as RendererTheme,
      reducedMotion: message.reducedMotion as boolean,
      locale: message.locale as string,
      ...(message.pane === undefined ? {} : {pane: message.pane as 'before' | 'after'}),
      ...(message.sizing === undefined ? {} : {sizing: message.sizing as 'content' | 'fill'}),
    }
  },
}

/**
 * Validates the shape of a host-to-renderer message. Documents inside `init`
 * are produced and validated by the host's engine; this checks the envelope
 * and message structure only.
 */
export function parseHostMessage(value: unknown, channel: string): HostMessage | undefined {
  if (!isEnvelope(value, channel)) return undefined
  const message = value as unknown as Record<string, unknown>
  const parse = typeof message.type === 'string' && Object.hasOwn(parsers, message.type) ? parsers[message.type] : undefined
  return parse?.(message)
}
