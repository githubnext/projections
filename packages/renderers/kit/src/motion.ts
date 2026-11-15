/** Clamps progress to [0, 1], rejecting nonfinite values rather than guessing. */
export function unitProgress(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Progress must be a finite number')
  return Math.max(0, Math.min(1, value))
}

/** Cubic smoothstep of `value` clamped to [0, 1]: eases in and out, with zero speed at either end. `ramp` uses it. */
export function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

/** Ease that settles without overshoot: fast departure, gentle arrival. */
export function settle(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (6 - 8 * t + 3 * t * t)
}

/**
 * Quintic smootherstep: a pronounced ease-in-out whose speed and acceleration
 * are both zero at either end, so a move starts and stops without a jolt.
 */
export function smootherstep(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * t * (t * (6 * t - 15) + 10)
}

/**
 * The kit's shared ease for anything a renderer interpolates from progress
 * (sizes, counts, angles, positions): the same quintic smootherstep graph
 * layouts move on, so every renderer starts and stops softly and a reversed
 * comparison draws the same frames. Ease the value, then round it for display.
 */
export function ease(value: number): number {
  return smootherstep(value)
}

/** `ease` applied to progress through `[start, end]`: 0 before the window, 1 after it. */
export function easeWithin(progress: number, start: number, end: number): number {
  return ease(within(progress, start, end))
}

/** Cubic ease-out: quick to start, gentle to arrive. Fade-ins use it. */
export function easeOut(value: number): number {
  const t = 1 - Math.max(0, Math.min(1, value))
  return 1 - t * t * t
}

/** Cubic ease-in, the mirror of `easeOut`: gentle to start, quick to finish. Fade-outs use it. */
export function easeIn(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * t
}

/** Presence of something fading in over `[center - radius, center + radius]`: eased out, so it arrives softly. */
export function fadeIn(progress: number, center: number, radius: number): number {
  if (radius <= 0) return progress < center ? 0 : 1
  return easeOut((progress - (center - radius)) / (radius * 2))
}

/**
 * Presence of something fading out over the window: eased in, so it leaves
 * softly. The exact mirror of `fadeIn`, so a reversed comparison draws the same frames.
 */
export function fadeOut(progress: number, center: number, radius: number): number {
  if (radius <= 0) return progress < center ? 1 : 0
  return 1 - easeIn((progress - (center - radius)) / (radius * 2))
}

/** 0 before `center - radius`, 1 after `center + radius`, smooth in between. */
export function ramp(progress: number, center: number, radius: number): number {
  if (radius <= 0) return progress < center ? 0 : 1
  return smoothstep((progress - (center - radius)) / (radius * 2))
}

/** Progress through a window `[start, end]`, clamped to [0, 1]. */
export function within(progress: number, start: number, end: number): number {
  if (end <= start) return progress < start ? 0 : 1
  return Math.max(0, Math.min(1, (progress - start) / (end - start)))
}
