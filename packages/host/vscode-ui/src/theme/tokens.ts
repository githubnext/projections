// VS Code's theme for renderer frames: the theme kind, the `--vscode-*` variables each theme token is read from, and the
// tokens they resolve to, kept at the contrast the token set promises.

import {
  composite,
  contrast,
  defaultThemeTokens,
  ensureContrast,
  formatColor,
  mix,
  parseColor,
  withAlpha,
} from '@githubnext/projections-host'
import type {Rgba, ThemeTokenName} from '@githubnext/projections-host'
import {codiconTokens} from '../icons.generated.js'
import {isHighContrast, vscodeColorMode} from './kinds.js'
import type {VscodeThemeKind, VscodeVariables} from './kinds.js'
import {fallbackFonts, vscodeMetrics, vscodeTokenMap} from './variables.js'

/** The longest token value the renderer protocol accepts. */
const maxValueLength = 512

/**
 * Resolves every renderer theme token from VS Code's `--vscode-*` variables, so renderer frames, which can't read the
 * webview's variables, follow the person's color theme: its editor surfaces, text, focus border, fonts, its git
 * decoration colors for added, removed and modified, and its diff editor fills. A missing variable keeps the token
 * set's default for the kind's color mode. Pure: pass captured variables (for example a fixture) or `readVscodeVariables`.
 */
export function vscodeThemeTokens(variables: VscodeVariables, kind: VscodeThemeKind): Record<ThemeTokenName, string> {
  const colorMode = vscodeColorMode(kind)
  const hc = isHighContrast(kind)
  const defaults = defaultThemeTokens(colorMode)
  const tokens: Record<ThemeTokenName, string> = {...defaults, ...vscodeMetrics, ...codiconTokens}
  const raw = (name: ThemeTokenName) => {
    for (const variable of vscodeTokenMap[name] ?? []) {
      const value = variables[variable]?.trim().replaceAll(/\s+/g, ' ')
      if (value && value.length <= maxValueLength && !value.includes('var(')) return value
    }
    return undefined
  }
  const color = (name: ThemeTokenName) => parseColor(raw(name))
  const fallback = (name: ThemeTokenName) => parseColor(defaults[name])!

  const bg = opaque(color('color-bg') ?? fallback('color-bg'))
  const extreme = colorMode === 'dark' ? white : black
  const base = ensureContrast(color('color-fg') ?? fallback('color-fg'), [bg], hc ? 7 : 4.5, extreme, bg)
  // Each step is a visible change in lightness toward the text, unless the theme draws it (high contrast: edges, not fills).
  const step = (surface: Rgba, from: Rgba, amount: number) => (contrast(surface, from) >= 1.06 || hc ? surface : mix(base, from, amount))
  const canvas = bg
  const raised = step(opaque(over(color('color-surface-raised'), bg) ?? bg), canvas, 0.04)
  const header = step(opaque(over(color('color-surface-header'), raised) ?? raised), raised, 0.06)
  const insetBase = opaque(over(color('color-surface-inset'), bg) ?? bg)
  const inset = contrast(insetBase, canvas) >= 1.06 || hc ? insetBase : mix(colorMode === 'dark' ? black : base, canvas, 0.04)
  const surfaces = [canvas, raised, header, inset]
  // Text reads on every surface: a dim theme foreground (Solarized's) is lifted toward white (or black) just enough.
  const fg = ensureContrast(base, surfaces, hc ? 7 : 4.5, extreme, bg)
  const text = (value: Rgba | undefined, ratio: number, against: readonly Rgba[] = [bg, raised], toward: Rgba = fg) =>
    ensureContrast(value ?? fg, against, ratio, toward, bg)
  const edge = (value: Rgba | undefined, against: readonly Rgba[] = surfaces) => ensureContrast(value ?? fg, against, 3, fg, bg)
  /** A fill behind plain `fg` text: as translucent as the theme draws it, and never so strong the text drops below 4.5:1. */
  const fill = (value: Rgba, base: Rgba = raised) => {
    let candidate = value
    for (let tries = 0; tries < 20 && contrast(fg, composite(candidate, base)) < (hc ? 7 : 4.5); tries++) {
      candidate = withAlpha(candidate, candidate.a * 0.8)
    }
    return candidate
  }
  const set = (name: ThemeTokenName, value: Rgba) => (tokens[name] = formatColor(value))

  set('color-bg', bg)
  set('color-fg', fg)
  set('color-fg-muted', text(color('color-fg-muted'), hc ? 7 : 4.5))
  set('color-fg-subtle', text(color('color-fg-subtle'), 3))
  set('color-fg-on-emphasis', bg)
  set('color-bg-subtle', inset)
  set('color-bg-inset', inset)
  set('color-bg-overlay', opaque(over(color('color-bg-overlay'), bg) ?? raised))
  set('color-surface-canvas', canvas)
  set('color-surface-raised', raised)
  set('color-surface-header', header)
  set('color-surface-inset', inset)
  set('color-divider', edge(color('color-divider')))
  const border = over(color('color-border'), bg) ?? mix(fg, bg, 0.15)
  set('color-border', hc ? edge(border) : opaque(border))
  set('color-border-muted', hc ? edge(border) : withAlpha(opaque(border), 0.7))
  set('color-border-emphasis', edge(color('color-border-emphasis'), [bg, raised]))
  const accent = text(color('color-accent'), 4.5)
  set('color-accent', accent)
  set('color-accent-emphasis', accent)
  set('color-accent-muted', fill(color('color-accent-muted') ?? withAlpha(accent, 0.15)))
  set('color-focus', edge(color('color-focus'), [bg, raised]))
  set('color-highlight', fill(color('color-highlight') ?? withAlpha(accent, 0.25)))
  for (const hue of ['added', 'removed', 'modified', 'moved'] as const) {
    // Toward white (or black), which keeps the hue, rather than toward the foreground, which may be gray.
    const base = text(color(`color-${hue}`) ?? fallback(`color-${hue}`), 4.5, surfaces, extreme)
    set(`color-${hue}`, base)
    set(`color-${hue}-emphasis`, base)
    set(`color-${hue}-border`, edge(color(`color-${hue}-border`) ?? base))
    set(`color-${hue}-muted`, fill(color(`color-${hue}-muted`) ?? withAlpha(base, hc ? 0.12 : 0.15)))
    set(`color-${hue}-highlight`, fill(color(`color-${hue}-highlight`) ?? withAlpha(base, hc ? 0.2 : 0.3)))
  }
  for (const name of [
    'font-family',
    'font-family-mono',
    'font-size-xs',
    'font-size-sm',
    'font-size',
    'font-size-xl',
    'font-weight-semibold',
    'font-weight-bold',
    'radius-sm',
    'radius',
    'radius-lg',
    'radius-full',
    'border-width',
    'label-font-size',
  ] as const) {
    const value = raw(name)
    if (value) tokens[name] = value
  }
  if (!raw('font-family')) tokens['font-family'] = fallbackFonts.sans
  if (!raw('font-family-mono')) tokens['font-family-mono'] = fallbackFonts.mono
  const shadow = parseColor(raw('shadow-md')) ?? (colorMode === 'dark' ? withAlpha(black, 0.36) : withAlpha(black, 0.16))
  // High contrast themes draw no shadows: edges carry elevation.
  const drop = formatColor(hc ? withAlpha(black, 0) : shadow)
  tokens['shadow-sm'] = `0 0 4px ${drop}`
  tokens['shadow-md'] = `0 0 8px 2px ${drop}`
  tokens['shadow-lg'] = `0 0 12px 4px ${drop}`
  return tokens
}

const black: Rgba = {r: 0, g: 0, b: 0, a: 1}
const white: Rgba = {r: 255, g: 255, b: 255, a: 1}
const opaque = (color: Rgba): Rgba => ({...color, a: 1})
const over = (color: Rgba | undefined, base: Rgba) => (color ? composite(color, base) : undefined)
