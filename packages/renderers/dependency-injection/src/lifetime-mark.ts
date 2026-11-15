import {halfWidth, kindBaseline, labelBaseline} from './geometry.js'
import type {Lifetime} from './model.js'

/**
 * The lifetime mark: a vertical stroke inset from the card's left side, beside the kind and name lines, solid for a
 * singleton, dashed for scoped and dotted for transient (`lifetimeDash`). `x` is its centre from the card's centre,
 * `stroke` its width; it runs from the kind line's cap height (`capHeight` above its baseline) to the name's baseline.
 */
export const lifetimeMark = {x: -halfWidth + 14, stroke: 3, capHeight: 9}
/** The lifetime mark's top and bottom on a card with one kind line and one name line, from the card's top. */
export const markSpan = {top: kindBaseline - lifetimeMark.capHeight, bottom: labelBaseline}

/**
 * The lifetime mark's dash pattern for a mark `length` card units long, drawn with round caps from
 * `stroke / 2` inside each end so it spans exactly that length: one solid stroke for a singleton, dashes for
 * scoped (one instance per scope; at least two, about 10 units long), round dots for transient (a new one each time), and sparse dots for an
 * implementation no registration resolves. Patterns of one length interpolate smoothly into each other.
 */
export function lifetimeDash(lifetime: Lifetime, length: number): [number, number] {
  const run = Math.max(0, length - lifetimeMark.stroke)
  if (lifetime === 'singleton') return [run, 0]
  if (lifetime === 'scoped') {
    // Dashes about 10 units long, at least two, 5 apart: long enough beside the round dots never to read as them.
    const gap = 5
    const dashes = Math.max(2, Math.round((length + gap) / (10 + gap)))
    return [Math.max(0, (length - (dashes - 1) * gap) / dashes - lifetimeMark.stroke), gap + lifetimeMark.stroke]
  }
  const spacing = lifetime === 'transient' ? 6.5 : 10
  const dots = Math.max(2, Math.round(run / spacing) + 1)
  return [0, run / (dots - 1)]
}
