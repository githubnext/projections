// Validating the optional presentation fields of a host's `init`: the definition's kinds and the opening focus.
import {kindColors, type KindColor} from '@githubnext/projections-schemas'
import {rendererLimits, type RendererKind} from './frame.js'
import {label, record} from './validation.js'

/** A definition's kind presentation, keeping only well-formed entries (see `RendererProjection.kinds`). */
export function parseKinds(value: unknown): Record<string, RendererKind> | undefined {
  if (!record(value)) return undefined
  const kinds: Record<string, RendererKind> = {}
  for (const [kind, entry] of Object.entries(value).slice(0, 64)) {
    if (!kind || kind.length > rendererLimits.summaryKind || !record(entry)) continue
    const {color, noun} = entry
    const parsed: RendererKind = {}
    if (typeof color === 'string' && (kindColors as readonly string[]).includes(color)) parsed.color = color as KindColor
    if (record(noun) && label(noun.singular, rendererLimits.summaryNoun) && label(noun.plural, rendererLimits.summaryNoun)) {
      parsed.noun = {singular: noun.singular, plural: noun.plural}
    }
    if (parsed.color || parsed.noun) kinds[kind] = parsed
  }
  return Object.keys(kinds).length ? kinds : undefined
}

/** A valid `RendererFocus`, or undefined when the init has none. */
export function focus(value: unknown): boolean {
  if (value === undefined) return true
  if (!record(value)) return false
  const {on, id, fit, ...rest} = value
  return (
    !Object.keys(rest).length &&
    (on === undefined || on === 'changes' || on === 'all') &&
    (id === undefined || (typeof id === 'string' && id.length <= rendererLimits.textLength)) &&
    (fit === undefined || typeof fit === 'boolean')
  )
}
