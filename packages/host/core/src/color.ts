// sRGB color arithmetic for mapping a host's theme onto renderer theme tokens at the contrast the token set promises.

/** An sRGB color with alpha, channels 0–255 and alpha 0–1. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Parses the sRGB color forms hosts write into their theme variables (VS Code's `--vscode-*`, the Copilot app's canvas
 * tokens): `#rgb(a)`, `#rrggbb(aa)`, `rgb()`, `rgba()` and `transparent`. Anything else is `undefined`.
 */
export function parseColor(value: string | undefined): Rgba | undefined {
  if (!value) return undefined
  const text = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? hex.replace(/./g, digit => digit + digit) : hex
    const channel = (index: number) => Number.parseInt(full.slice(index * 2, index * 2 + 2), 16)
    return {r: channel(0), g: channel(1), b: channel(2), a: full.length === 8 ? channel(3) / 255 : 1}
  }
  // One run of anything but `)`: the parts are split (and blanks dropped) below, so no backtracking between runs.
  const functional = /^rgba?\(([^)]+)\)$/.exec(text)?.[1]
  if (functional) {
    const parts = functional.split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3 || parts.length > 4) return undefined
    const numbers = parts.map((part, index) =>
      part.endsWith('%') ? (Number(part.slice(0, -1)) / 100) * (index < 3 ? 255 : 1) : Number(part),
    )
    if (numbers.some(number => !Number.isFinite(number))) return undefined
    return {r: clamp(numbers[0]!, 0, 255), g: clamp(numbers[1]!, 0, 255), b: clamp(numbers[2]!, 0, 255), a: clamp(numbers[3] ?? 1, 0, 1)}
  }
  if (text === 'transparent') return {r: 0, g: 0, b: 0, a: 0}
  return undefined
}

const hexByte = (value: number) =>
  Math.round(clamp(value, 0, 255))
    .toString(16)
    .padStart(2, '0')

/** `#rrggbb`, or `#rrggbbaa` when translucent. */
export function formatColor(color: Rgba): string {
  const alpha = Math.round(clamp(color.a, 0, 1) * 255)
  return `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}${alpha === 255 ? '' : hexByte(alpha)}`
}

/** `top` painted over `bottom` (source-over); the result is opaque when `bottom` is. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a)
  if (a === 0) return {r: 0, g: 0, b: 0, a: 0}
  const channel = (front: number, back: number) => (front * top.a + back * bottom.a * (1 - top.a)) / a
  return {r: channel(top.r, bottom.r), g: channel(top.g, bottom.g), b: channel(top.b, bottom.b), a}
}

/** `amount` (0–1) of `a` mixed into `b`, channel by channel (alpha too). */
export function mix(a: Rgba, b: Rgba, amount: number): Rgba {
  const t = clamp(amount, 0, 1)
  return {r: a.r * t + b.r * (1 - t), g: a.g * t + b.g * (1 - t), b: a.b * t + b.b * (1 - t), a: a.a * t + b.a * (1 - t)}
}

/** The color at `alpha` opacity. */
export const withAlpha = (color: Rgba, alpha: number): Rgba => ({...color, a: clamp(alpha, 0, 1)})

function linear(channel: number): number {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of an opaque color. */
export function luminance(color: Rgba): number {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

/** The WCAG contrast ratio of `foreground` (composited over `background`) against the opaque `background`. */
export function contrast(foreground: Rgba, background: Rgba): number {
  const back = background.a < 1 ? composite(background, {r: 255, g: 255, b: 255, a: 1}) : background
  const front = foreground.a < 1 ? composite(foreground, back) : foreground
  const [light, dark] = [luminance(front), luminance(back)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/**
 * `color`, opaque over `background`, moved toward `toward` (the theme's foreground) just far enough to reach `ratio`
 * against every one of `against`, so a theme's own color is kept wherever it already has the contrast.
 */
export function ensureContrast(color: Rgba, against: readonly Rgba[], ratio: number, toward: Rgba, background: Rgba): Rgba {
  const opaque = color.a < 1 ? composite(color, background) : color
  const enough = (candidate: Rgba) => against.every(surface => contrast(candidate, surface) >= ratio)
  if (enough(opaque)) return opaque
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(toward, opaque, step / 20)
    if (enough(candidate)) return candidate
  }
  return toward
}
