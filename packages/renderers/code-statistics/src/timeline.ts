import {ease, easeWithin, stepProgress, unitProgress} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel, ScheduledStep} from '@githubnext/projections-renderer-kit'
import {codeStatisticsMeasures, defaultCodeStatisticsOptions} from '@githubnext/projections-renderer-sdk/presentation'
import type {CodeStatisticsMeasure, CodeStatisticsOptions} from '@githubnext/projections-renderer-sdk/presentation'

export {codeStatisticsMeasures, defaultCodeStatisticsOptions}
export type {CodeStatisticsMeasure, CodeStatisticsOptions}

/** How far a language row has moved from its Before to its After count, and how present it is. */
export interface StatisticsMotion {
  /** Share of its slot the row occupies. */
  size: number
  opacity: number
  /** 0 shows the Before count, 1 the After count (an absent side counts as 0). */
  mix: number
  /** Progress through the row's own step: labels switch at one half. */
  local: number
}

/**
 * Each language changes in its own comparison step, so a custom comparator's
 * order is what plays, and nothing moves in the kit's holds between steps.
 * Inside its step an arriving language opens its slot, then fades in empty at
 * its destination, then grows; a departing one shrinks to empty, fades, then
 * closes its slot (the exact mirror); a resized one eases between its counts
 * across the window. Every phase follows the kit's shared `ease` (the quintic
 * curve graph layouts move on), so bars, hatches, slices and counts all start
 * and stop softly.
 */
export function statisticsMotion(
  model: ComparisonModel,
  schedule: readonly ScheduledStep[],
): (id: string, progress: number) => StatisticsMotion {
  const rows = new Map(model.entities.map(row => [row.id, row]))
  const stepOf = new Map<string, ScheduledStep>()
  for (const step of schedule) for (const id of step.entities) stepOf.set(id, step)
  return (id, progress) => {
    const row = rows.get(id)
    const step = stepOf.get(id)
    const t = unitProgress(progress)
    // A row no step changes (or an extraction) is the same on both sides.
    const local = step ? stepProgress(step, t) : 0
    if (!row || (row.before && row.after)) return {size: 1, opacity: 1, mix: ease(local), local}
    // The fade starts only once the slot is 95% open (and the slot closes once the fade is 95% done).
    if (row.after) return {size: easeWithin(local, 0, 0.55), opacity: easeWithin(local, 0.45, 0.7), mix: easeWithin(local, 0.7, 1), local}
    return {size: 1 - easeWithin(local, 0.45, 1), opacity: 1 - easeWithin(local, 0.3, 0.55), mix: easeWithin(local, 0, 0.3), local}
  }
}

export function signed(value: number, format: (value: number) => string = value => value.toLocaleString()): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}`
}

/** One donut slice as an SVG path, drawn as half-turn arcs so a single slice can span a whole turn. */
export function donutSlice(centre: number, outer: number, inner: number, start: number, end: number): string {
  const sweep = end - start
  if (sweep <= 0) return ''
  const steps = Math.max(1, Math.ceil(sweep / Math.PI))
  const step = sweep / steps
  const at = (radius: number, angle: number) =>
    `${(centre + radius * Math.cos(angle)).toFixed(2)},${(centre + radius * Math.sin(angle)).toFixed(2)}`
  let path = `M${at(outer, start)}`
  for (let index = 0; index < steps; index++) path += ` A${outer},${outer} 0 0 1 ${at(outer, start + step * (index + 1))}`
  path += ` L${at(inner, end)}`
  for (let index = 0; index < steps; index++) path += ` A${inner},${inner} 0 0 0 ${at(inner, end - step * (index + 1))}`
  return `${path} Z`
}
