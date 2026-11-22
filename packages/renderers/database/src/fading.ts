import {ramp, type StepWindows} from '@githubnext/projections-renderer-kit'
import type {SchemaBox} from './schema.js'

/** Below this, an item is invisible and omitted from the frame. */
export const VISIBLE = 1e-6
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

/** Indexes of one longest increasing subsequence of `values`. */
export function longestIncreasing(values: readonly number[]): Set<number> {
  const tails: number[] = [],
    previous: number[] = []
  for (const [index, value] of values.entries()) {
    let low = 0,
      high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (values[tails[middle]!]! < value) low = middle + 1
      else high = middle
    }
    previous[index] = low ? tails[low - 1]! : -1
    tails[low] = index
  }
  const result = new Set<number>()
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]!) result.add(index)
  return result
}
export const lerpBox = (a: SchemaBox, b: SchemaBox, t: number): SchemaBox => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  width: lerp(a.width, b.width, t),
  height: lerp(a.height, b.height, t),
})

/** A link drawn another way in the next stage fades out on its old drawing, is absent mid-move, and fades in on its new one. */
export function redrawPresence(mix: number): number {
  return mix < 0.5 ? 1 - smooth(Math.min(1, mix / 0.35)) : smooth(Math.max(0, (mix - 0.65) / 0.35))
}

/**
 * Opacity of something whose existence per stage is `exists`: each change of
 * existence fades in the window of the step that causes it (leaving rows fade
 * out before the layout closes their gap; arriving rows fade in after it has
 * made room). Existence starts at stage `start`; steps in `skip` don't fade
 * it, because something else (its card) carries the fade.
 */
export function fader(exists: readonly boolean[], windows: readonly StepWindows[], skip?: (step: number) => boolean, start = 0) {
  const base = Number(exists[start] ?? false)
  const changes: {sign: number; time: number; radius: number}[] = []
  for (let step = start; step < windows.length; step++) {
    if (skip?.(step) || exists[step] === exists[step + 1]) continue
    const window = exists[step + 1] ? windows[step]!.fadeIn : windows[step]!.fadeOut
    changes.push({sign: exists[step + 1] ? 1 : -1, time: window.time, radius: window.radius})
  }
  return (t: number) => {
    let value = base
    for (const change of changes) value += change.sign * ramp(t, change.time, change.radius)
    return Math.max(0, Math.min(1, value))
  }
}
