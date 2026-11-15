// Progress through a presentation: clamping, easing, change emphasis and the phases of a step.

/**
 * `value` clamped to the unit interval, 0 to 1: the normal form of every progress the presentation helpers take.
 *
 * @throws `RangeError` when `value` is `NaN` or infinite, so a bad progress fails loudly instead of drawing a blank.
 */
export function unit(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Progress must be a finite number')
  return Math.max(0, Math.min(1, value))
}

function smooth(value: number): number {
  const t = unit(value)
  return t * t * (3 - 2 * t)
}

/**
 * The change emphasis hosts send as `highlighting` while a comparison plays: exactly 0 at both endpoints, easing up
 * over the first 10% of progress, 1 through the middle, and easing down over the last 10%, so endpoints show each
 * revision plainly. Progress is clamped to 0 to 1.
 *
 * @throws `RangeError` when `progress` isn't finite.
 */
export function diffEmphasis(progress: number): number {
  const t = unit(progress)
  return Math.min(smooth(t / 0.1), smooth((1 - t) / 0.1))
}

/**
 * How a step uses its motion (`stepProgress`, after any reading lead), as
 * fractions of the step's own progress: leaving items fade out first, shared
 * motion (layouts, values, rewiring) happens in the middle, and arriving items
 * fade in last, so nothing that is about to leave or has just arrived is ever
 * caught mid-motion.
 */
export const stepPhases = {fadeOut: [0, 0.3], move: [0.3, 0.7], fadeIn: [0.7, 1]} as const

/** Progress through one phase of a step (see `stepPhases`), eased. */
export function phaseProgress(local: number, phase: readonly [number, number]): number {
  return smooth((unit(local) - phase[0]) / (phase[1] - phase[0]))
}
