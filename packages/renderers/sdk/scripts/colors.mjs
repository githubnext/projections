// Color math for the generated palettes (Linguist language colors, the chart palette checks): sRGB ↔ OKLab/OKLCH,
// WCAG contrast, and moving a color's lightness until it stands out from a background while keeping its hue.

const toLinear = value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
const toGamma = value => (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055)

/** `#rrggbb` to linear sRGB channels. */
export function linear(hex) {
  return [1, 3, 5].map(index => toLinear(Number.parseInt(hex.slice(index, index + 2), 16) / 255))
}

/** WCAG relative luminance. */
export function luminance(hex) {
  const [r, g, b] = linear(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two `#rrggbb` colors. */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].toSorted((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** `#rrggbb` to OKLab `[L, a, b]`. */
export function oklab(hex) {
  const [r, g, b] = linear(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab to linear sRGB (possibly out of gamut). */
function linearFromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** `#rrggbb` to OKLCH `[L, C, h°]`. */
export function oklch(hex) {
  const [L, a, b] = oklab(hex)
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]
}

/** OKLCH to `#rrggbb`, reducing chroma until the color is in the sRGB gamut. */
export function fromOklch([L, C, h]) {
  const angle = (h * Math.PI) / 180
  let chroma = C
  for (;;) {
    const channels = linearFromOklab([L, chroma * Math.cos(angle), chroma * Math.sin(angle)])
    if (channels.every(value => value >= -1e-4 && value <= 1 + 1e-4) || chroma <= 0) {
      return `#${channels
        .map(value =>
          Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, value))))) * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')}`
    }
    chroma = Math.max(0, chroma - 0.002)
  }
}

/** Perceptual distance (OKLab ΔE) between two `#rrggbb` colors. */
export function distance(a, b) {
  const [x, y] = [oklab(a), oklab(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

/**
 * The color with the smallest lightness change (same hue, as much of its chroma as the gamut allows) whose contrast
 * against `background` is at least `minimum`.
 */
export function withContrast(hex, background, minimum) {
  if (contrast(hex, background) >= minimum) return hex
  const [L, C, h] = oklch(hex)
  const direction = luminance(background) > 0.18 ? -1 : 1
  for (let step = 1; step <= 250; step++) {
    const candidate = fromOklch([Math.min(1, Math.max(0, L + direction * step * 0.004)), C, h])
    if (contrast(candidate, background) >= minimum) return candidate
  }
  throw new Error(`No lightness of ${hex} reaches ${minimum}:1 against ${background}`)
}

/**
 * Moves `hex` in lightness (keeping its hue) until it is at least `gap` (OKLab ΔE) from every color in `others`,
 * staying at least `minimum`:1 against `background`. Tries the smaller move first, in either direction.
 */
export function apart(hex, others, background, minimum, gap) {
  const clear = candidate => others.every(other => distance(candidate, other) >= gap) && contrast(candidate, background) >= minimum
  if (clear(hex)) return hex
  const [L, C, h] = oklch(hex)
  for (let step = 1; step <= 100; step++) {
    for (const direction of [1, -1]) {
      const candidate = fromOklch([Math.min(1, Math.max(0, L + direction * step * 0.005)), C, h])
      if (clear(candidate)) return candidate
    }
  }
  return hex
}
