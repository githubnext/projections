// Comparison modes: which a renderer supports, in what order, and which a host opens with.
import {comparisonModes} from '@githubnext/projections-schemas'

/** How a host presents a comparison with a renderer; the schemas package defines the list for the manifest schema too. */
export {comparisonModes}
/** One of `comparisonModes`. */
export type ComparisonMode = (typeof comparisonModes)[number]

/** The modes a renderer supports when it declares none: every progress-driven mode. */
export const defaultComparisonModes: readonly ComparisonMode[] = ['side-by-side', 'animated', 'swipe']

/**
 * Modes in the order hosts show them, whatever order a renderer declares
 * them in: diff, side by side, animated, then swipe (`comparisonModes`).
 */
export function orderComparisonModes(modes: readonly ComparisonMode[]): ComparisonMode[] {
  return comparisonModes.filter(mode => modes.includes(mode))
}

/**
 * The mode a comparison opens in: the renderer's first supported mode in
 * canonical order, so diff when it supports diff, else side by side. A
 * renderer chooses only which modes it supports.
 */
export function defaultComparisonMode(modes: readonly ComparisonMode[]): ComparisonMode {
  return orderComparisonModes(modes.length ? modes : defaultComparisonModes)[0] ?? 'side-by-side'
}

/** Validates a `comparisonModes` declaration: a non-empty list of distinct known modes, in any order. */
export function parseComparisonModes(value: unknown): ComparisonMode[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > comparisonModes.length) return undefined
  const modes: unknown[] = value
  if (!modes.every(isComparisonMode) || new Set(modes).size !== modes.length) return undefined
  return modes.filter(isComparisonMode)
}

function isComparisonMode(mode: unknown): mode is ComparisonMode {
  return comparisonModes.some(known => known === mode)
}

/** The comparison modes a renderer supports, in canonical order (see `defaultComparisonMode`). */
export function supportedComparisonModes(
  declared: {comparisonModes?: readonly ComparisonMode[] | undefined} | undefined,
): readonly ComparisonMode[] {
  return orderComparisonModes(declared?.comparisonModes?.length ? declared.comparisonModes : defaultComparisonModes)
}
