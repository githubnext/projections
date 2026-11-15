// The calibration of category colors (Linguist language colors and the chart palette) to the Projector theme: every
// category keeps its hue, but its chroma is capped and its lightness drawn into one narrow band per theme, so all
// categories read as one family on the warm canvas, stay at least 3:1 against it, and stay clearly less saturated
// than the change colors (added, removed, modified, moved), which therefore always stand out from file types.
import {contrast, distance, fromOklch, oklch} from './colors.mjs'

/**
 * Calibration profiles: chroma cap and lightness band (OKLCH) per theme. `default` is the shipped one; `softer` and
 * `stronger` are a step either side, for comparison (`node scripts/linguist.mjs --profile softer`).
 */
export const profiles = {
  softer: {light: {chroma: 0.07, band: [0.58, 0.65]}, dark: {chroma: 0.075, band: [0.66, 0.76]}},
  default: {light: {chroma: 0.09, band: [0.56, 0.64]}, dark: {chroma: 0.092, band: [0.68, 0.78]}},
  stronger: {light: {chroma: 0.115, band: [0.54, 0.62]}, dark: {chroma: 0.12, band: [0.7, 0.8]}},
}

/** Minimum contrast of a category color against the stage background. */
export const minimumContrast = 3.05

/**
 * Category chroma may be at most this share of the least saturated change color (its base, emphasis or border
 * tone), so change status always reads as more saturated than file type.
 */
export const changeChromaRatio = 0.8

const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

/**
 * One color on the profile: the original's hue, its chroma capped, and its lightness mapped from the usual range of
 * language colors (0.3–0.95) into the band, then darkened or lightened only as far as 3:1 against `background`
 * needs. A light yellow (JavaScript) turns slightly toward gold in a light theme, so it doesn't read as olive.
 */
export function calibrate(hex, background, {chroma, band}) {
  const [L, C, h] = oklch(hex)
  const lightness = band[0] + (band[1] - band[0]) * clamp((L - 0.3) / 0.65, 0, 1)
  // A yellow darkened enough for a light background reads as olive; it turns up to 11° toward gold instead.
  const light = oklch(background)[0] > 0.5
  const hue = light && h >= 92 && h <= 115 && C > 0.06 ? Math.max(h - 11, 91) : h
  return withinContrast([lightness, Math.min(C, chroma), hue], background)
}

/** The OKLCH color, its lightness moved toward the background's opposite until it reaches the minimum contrast. */
export function withinContrast([L, C, h], background) {
  const darker = oklch(background)[0] > 0.5
  for (let step = 0; step <= 200; step++) {
    const candidate = fromOklch([clamp(L + (darker ? -1 : 1) * step * 0.003, 0, 1), C, h])
    if (contrast(candidate, background) >= minimumContrast) return candidate
  }
  throw new Error(`No lightness of ${fromOklch([L, C, h])} reaches ${minimumContrast}:1 against ${background}`)
}

/**
 * `hex` moved (lightness within the band, hue by up to 15°, or both; the smallest move first) until it is at least `gap`
 * (OKLab ΔE) from every color in `others`, keeping its chroma and 3:1 against `background`. Returns `hex` unchanged
 * when no such move exists.
 */
export function separate(hex, others, background, {band}, gap) {
  const clear = candidate => others.every(other => distance(candidate, other) >= gap) && contrast(candidate, background) >= minimumContrast
  if (clear(hex)) return hex
  const [L, C, h] = oklch(hex)
  const moves = []
  // Lightness within the band (and a little past it), hue by up to 15°, and both together; the smallest move wins.
  for (let lightStep = -25; lightStep <= 25; lightStep++) {
    const lightness = L + lightStep * 0.004
    if (lightness < band[0] - 0.04 || lightness > band[1] + 0.04) continue
    for (let hueStep = -15; hueStep <= 15; hueStep++) {
      if (!lightStep && !hueStep) continue
      moves.push([Math.hypot(lightStep * 0.004, hueStep * 0.0045), [lightness, C, h + hueStep]])
    }
  }
  moves.sort((a, b) => a[0] - b[0])
  for (const [, color] of moves) {
    const candidate = fromOklch(color)
    if (clear(candidate)) return candidate
  }
  return hex
}

/**
 * The categorical palette's hues (OKLCH): sixteen, 22.5° apart around the wheel, in slot order (the first eight away
 * from the change hues: green, red, amber, violet). At capped chroma neighboring hues alone are close, so going around
 * the wheel they alternate between the low and high end of the lightness band (the second number).
 */
export const chartHues = [
  ['blue', 252, 1],
  ['teal', 185, 0],
  ['pink', 342, 1],
  ['lime', 118, 1],
  ['purple', 320, 0],
  ['cyan', 208, 1],
  ['indigo', 275, 0],
  ['sky', 230, 0],
  ['orange', 50, 0],
  ['green', 140, 0],
  ['red', 27, 1],
  ['violet', 298, 1],
  ['emerald', 162, 1],
  ['rose', 5, 0],
  ['amber', 72, 1],
  ['citron', 95, 0],
]

/** The chart palette for a profile: `[light, dark]` per slot. */
export function chartPalette(profile, backgrounds) {
  return chartHues.map(([, hue, offset]) =>
    ['light', 'dark'].map(mode => {
      const {chroma, band} = profile[mode]
      return withinContrast([band[0] + (band[1] - band[0]) * offset, chroma, hue], backgrounds[mode])
    }),
  )
}

/** Separation tiers: the most common languages keep `wide` apart (OKLab ΔE); the rest `narrow`. */
export const separation = {commonCount: 16, wide: 0.05, narrow: 0.03}

/** The profile named by `--profile` (default `default`). */
export function profileArgument(argv = process.argv) {
  const index = argv.indexOf('--profile')
  const name = index > 0 ? argv[index + 1] : 'default'
  if (!(name in profiles)) throw new Error(`--profile must be one of ${Object.keys(profiles).join(', ')}`)
  return {name, profile: profiles[name]}
}
