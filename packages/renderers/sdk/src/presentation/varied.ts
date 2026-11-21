// Volatile values: how a change that varied within or beyond tolerance is presented.
import type {ChangeStatus, Varied} from '@githubnext/projections-schemas'

/** A row with the comparison's status and volatile values (`EntityChange`, a host row). */
export interface VariedChange {
  /** The row's change status; `variedWithin` looks for `unchanged` and `variedBeyond` for `modified`. */
  status?: ChangeStatus | undefined
  /** The comparison's volatile values for the row (`change.varied`), each within or beyond its tolerance. */
  varied?: readonly Varied[] | undefined
}

/**
 * Whether a change varied only within tolerance: `unchanged`, with `varied`.
 * Such an item is presented exactly as an unchanged one: no emphasis, status
 * or motion.
 */
export function variedWithin(change: VariedChange): boolean {
  return change.status === 'unchanged' && Boolean(change.varied?.length)
}

/**
 * Whether a change is `modified` with a volatile value beyond its tolerance,
 * which presentations mark with the neutral `varied` icon beside the
 * change's status. A generated value regenerated from a changed basis isn't
 * one: it changed for a reason, which its field says (`generatedWords`).
 */
export function variedBeyond(change: VariedChange): boolean {
  return change.status === 'modified' && Boolean(change.varied?.some(entry => !entry.within && !entry.generated))
}

/** How a varied value relates to its tolerance, in words: `within tolerance` or `beyond tolerance (volatile)`. */
export function variedWords(within: boolean): string {
  return within ? 'within tolerance' : 'beyond tolerance (volatile)'
}

/** The accessible name of the volatile marker (`variedBeyond`). */
export const variedBeyondLabel = 'Volatile field changed beyond tolerance'

const pointerSegments = (path: string): string[] =>
  path
    .split('/')
    .slice(1)
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))

/**
 * A varied value's name for display: its pointer below `/data/`, segments
 * unescaped and joined with `/` (`/data/durationMs` is `durationMs`).
 */
export function variedName(path: string): string {
  const segments = pointerSegments(path)
  return (segments[0] === 'data' && segments.length > 1 ? segments.slice(1) : segments).join('/')
}

/** The value a varied path (an RFC 6901 pointer into the item) points to, or `undefined`. */
export function variedValue(item: unknown, path: string): unknown {
  let value: unknown = item
  for (const segment of pointerSegments(path)) {
    if (Array.isArray(value)) value = /^(0|[1-9][0-9]*)$/.test(segment) ? value[Number(segment)] : undefined
    else if (value !== null && typeof value === 'object' && Object.hasOwn(value, segment)) {
      value = (value as Record<string, unknown>)[segment]
    } else return undefined
  }
  return value
}
