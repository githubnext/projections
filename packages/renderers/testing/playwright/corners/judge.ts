// What is wrong with a measured corner: its arc against its sides, and colours in or past its border.
import type {CornerMeasure} from './analyze.js'

/** An arc's mean thickness held between `min` and `max` of its sides' (a fill against the curve thins it). */
function arcFailures(corner: CornerMeasure, sides: number[], label: string, ratio: {min: number; max: number}): string[] {
  const measured = corner.rays.flatMap(ray => (ray.thickness === null ? [] : [ray.thickness]))
  if (!sides.length || !measured.length) return []
  const mean = measured.reduce((sum, value) => sum + value, 0) / measured.length
  const said = sides.map(side => side.toFixed(2)).join(' and ')
  const failures: string[] = []
  if (mean < Math.min(...sides) * ratio.min) {
    failures.push(
      `${label} ${corner.name} corner: the border is ${mean.toFixed(2)} px around the curve, under ${Math.round(ratio.min * 100)}% of its sides' ${said} px: a fill thins it`,
    )
  }
  if (mean > Math.max(...sides) * ratio.max) {
    failures.push(
      `${label} ${corner.name} corner: the border is ${mean.toFixed(2)} px around the curve, over ${ratio.max}× its sides' ${said} px`,
    )
  }
  return failures
}

/**
 * Within a quarter CSS pixel, plus half a device pixel of antialiasing, of its sides; between them where they differ
 * (a change run's strong side edge turning into a plain bottom border). With `ratio`, the arc's mean thickness against
 * its sides' instead, ray by ray.
 */
export function cornerFailures(corner: CornerMeasure, scale: number, label: string, ratio?: {min: number; max: number}): string[] {
  const tolerance = 0.25 + 0.5 / scale
  // A colour this far from every blend of outside, border and inside, or from the outside past the curve.
  const stray = 60
  const sides = corner.sides.filter((side): side is number => side !== null)
  const failures = ratio ? arcFailures(corner, sides, label, ratio) : []
  for (const ray of corner.rays) {
    const at = `${label} ${corner.name} corner at ${ray.angle}°`
    if (!ratio && ray.thickness !== null && sides.length) {
      const low = Math.min(...sides) - tolerance,
        high = Math.max(...sides) + tolerance
      if (ray.thickness < low || ray.thickness > high) {
        failures.push(
          `${at}: the border is ${ray.thickness.toFixed(2)} px around the curve but ${sides.map(side => side.toFixed(2)).join(' and ')} px on its sides`,
        )
      }
    }
    if (ray.foreign > stray) {
      failures.push(`${at}: a colour that is neither the border nor what it edges shows in the border (a fill not concentric with it)`)
    }
    if (ray.outside > stray) failures.push(`${at}: paint shows outside the curve`)
  }
  return failures
}
