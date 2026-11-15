// The renderer's `steps` message: where the host may hold, and how many step slots the presentation spans.
import {rendererLimits} from './frame.js'
import type {RendererMessage} from './messages.js'
import {envelopeKeys, finite, keys} from './validation.js'

/** Ascending positions in 0–1, at most `rendererLimits.steps`. */
const stepEnds = (ends: unknown): ends is number[] =>
  Array.isArray(ends) &&
  ends.length <= rendererLimits.steps &&
  ends.every((end, index) => finite(end) && end >= 0 && end <= 1 && (index === 0 || end > (ends[index - 1] as number)))

/** A step-slot count: absent, or between 0 and twice `rendererLimits.steps` (every step with a reading part). */
const stepSlots = (slots: unknown): slots is number | undefined =>
  slots === undefined || (finite(slots) && slots >= 0 && slots <= 2 * rendererLimits.steps)

export function steps(message: Record<string, unknown>): RendererMessage | undefined {
  if (!keys(message, [...envelopeKeys, 'ends', 'slots']) || !stepEnds(message.ends) || !stepSlots(message.slots)) return undefined
  return {type: 'steps', ends: [...message.ends], ...(message.slots === undefined ? {} : {slots: message.slots})}
}
