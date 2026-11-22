// Validators the message parsers share.
import {rendererProtocolVersion, rendererLimits, type Envelope} from './frame.js'

export const cssColor = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]{1,64}\))$/i

/**
 * Whether `value` is an RFC 6901 JSON pointer (for example `/data/owner`),
 * the form of property paths in `select`.
 */
export function isPropertyPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= rendererLimits.textLength &&
    (value === '' || (value.startsWith('/') && !/~[^01]|~$/.test(value)))
  )
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function text(value: unknown): value is string {
  return typeof value === 'string' && value.length <= rendererLimits.textLength
}
export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
export function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}
export const envelopeKeys = ['projections', 'channel', 'type']

export const tokenNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/
/** A renderer name, as `renderer.json` declares it. */
export const rendererNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/
export const controlIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

export function label(value: unknown, max = 80): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

export const coordinate = (value: unknown): value is number => finite(value) && Math.abs(value) <= rendererLimits.maxCoordinate

/** Whether a value is an envelope for this protocol version and channel. */
export function isEnvelope(value: unknown, channel: string): value is Envelope & {type: string} {
  return record(value) && value.projections === rendererProtocolVersion && value.channel === channel && typeof value.type === 'string'
}

/** An `init`'s generation (`HostMessage`): a non-negative safe integer. */
export function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
