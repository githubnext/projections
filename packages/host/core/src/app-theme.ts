// An embedding app's theme for renderer frames and the default UI's chrome: a few of the app's colors and families
// (its stage, text, rules, focus and accent) mapped onto renderer theme token overrides that keep the token set's
// contrast. The GitHub Copilot app's canvas (copilot-canvas-theme.ts) maps its own variables onto these.

import {
  defaultThemeTokens,
  optionalThemeTokenNames,
  rendererLimits,
  themeTokenNames,
  type ColorMode,
  type ThemeTokenName,
} from '@githubnext/projections-renderer-sdk/protocol'
import {composite, contrast, ensureContrast, formatColor, mix, parseColor, withAlpha, type Rgba} from './color.js'

/**
 * An app's theme, as CSS values: colors as sRGB (`#rrggbb(aa)`, `rgb()`, `rgba()`), families as plain font lists. A
 * missing one keeps the token set's default; without a `background` there is no app theme.
 */
export interface AppThemeColors {
  /** The stage: the app's own surface. */
  background?: string | undefined
  text?: string | undefined
  muted?: string | undefined
  /** Rules and edges. */
  border?: string | undefined
  /** The focus ring; the accent when there is no `accent`. */
  focus?: string | undefined
  /** The accent (selection, links, the lens); the focus ring when there is no `focus`. */
  accent?: string | undefined
  sans?: string | undefined
  mono?: string | undefined
}

/**
 * How an app theme draws its rules and card edges: `contrast` (the default) lifts the app's border to 3:1 against
 * every surface, as the token set's divider promises; `app` draws them in the app's own border, as given (the Copilot
 * canvas and theme seeds, whose apps' rules are quiet), and sends lines that carry meaning (`color-connector`) at 3:1 instead.
 */
export type AppThemeRules = 'contrast' | 'app'

/**
 * Renderer theme token overrides from an app's colors, so a renderer's stage, cards, text, rules, accent, focus ring
 * and type are the app's own: `color-bg` and the stage (`color-surface-canvas`) are the background, cards and header
 * bands one visible step from it toward the text, text and muted text the app's, rules its border, the accent and focus
 * ring its accent and focus, and the families its own.
 *
 * Change colors (added, removed, modified, moved) and the categorical palette stay the token set's: they carry
 * meaning, are calibrated as families (base, fill, edge, highlight; the first eight chart hues avoid the change hues),
 * and an app's palette has no diff semantics. They are only moved, toward white (or black) to keep their hue, where the
 * app's surfaces would take them below the contrast the token set promises.
 *
 * Every override keeps that contrast: text 4.5:1 against the surfaces, edges, the divider and focus 3:1, fills drawn
 * behind text keep it readable. A color that is missing or isn't an sRGB color (or a safe font list) keeps the default
 * it would have replaced; without a background there is no app theme, and no overrides. Only token names of the
 * current set are returned, each a value the renderer protocol accepts. With `rules` `app`, rules and card edges are
 * the app's border as given, and only `color-connector` (and controls) keep 3:1.
 */
export function appThemeTokens(
  colors: AppThemeColors,
  colorMode: ColorMode,
  rules: AppThemeRules = 'contrast',
): Partial<Record<ThemeTokenName, string>> {
  const defaults = defaultThemeTokens(colorMode)
  const color = (value: string | undefined) => parseColor(value?.trim())
  const fallback = (name: ThemeTokenName) => parseColor(defaults[name])!
  const dark = colorMode === 'dark'
  const extreme = dark ? white : black

  const app = color(colors.background)
  if (!app) return {}
  const bg = opaque(composite(app, dark ? black : white))
  const fg = ensureContrast(color(colors.text) ?? fallback('color-fg'), [bg], 4.5, extreme, bg)
  const canvas = bg
  // Cards lie one visible step above the stage: lighter in dark mode; in light mode white on a tinted stage (as the
  // app's own boxes are), or a step toward the text on a white one.
  const room = contrast(white, canvas)
  const raised = dark || room >= raisedStep ? step(canvas, white, raisedStep) : room >= 1.04 ? white : step(canvas, fg, raisedStep)
  const header = step(raised, fg, headerStep)
  const inset = step(canvas, dark ? black : fg, insetStep)
  const surfaces = [canvas, raised, header, inset]
  const text = ensureContrast(fg, surfaces, 4.5, extreme, bg)
  const muted = ensureContrast(color(colors.muted) ?? fallback('color-fg-muted'), surfaces, 4.5, text, bg)
  const subtle = ensureContrast(mix(muted, bg, 0.75), surfaces, 3, text, bg)
  const rule = color(colors.border)
  const border = rule ? opaque(composite(rule, bg)) : mix(text, bg, 0.15)
  const edge = ensureContrast(border, surfaces, 3, text, bg)
  const accent = ensureContrast(color(colors.accent) ?? color(colors.focus) ?? fallback('color-accent'), [canvas, raised], 4.5, extreme, bg)
  const focus = ensureContrast(color(colors.focus) ?? accent, [canvas, raised], 3, text, bg)
  /** A fill behind plain `color-fg` text: as translucent as needed for that text to keep 4.5:1. */
  const fill = (value: Rgba) => {
    let candidate = value
    for (let tries = 0; tries < 20 && contrast(text, composite(candidate, raised)) < 4.5; tries++) {
      candidate = withAlpha(candidate, candidate.a * 0.8)
    }
    return candidate
  }

  const tokens: Partial<Record<ThemeTokenName, string>> = {}
  const set = (name: ThemeTokenName, value: Rgba) => (tokens[name] = formatColor(value))
  set('color-bg', bg)
  set('color-fg', text)
  set('color-fg-muted', muted)
  set('color-fg-subtle', subtle)
  set('color-fg-on-emphasis', onEmphasis(bg, accent))
  set('color-bg-subtle', inset)
  set('color-bg-inset', inset)
  set('color-bg-overlay', raised)
  set('color-surface-canvas', canvas)
  set('color-surface-raised', raised)
  set('color-surface-header', header)
  set('color-surface-inset', inset)
  // An app's own rules, when it asks for them: its border as given, and its edge only for lines that carry meaning.
  const own = rules === 'app' && rule !== undefined
  set('color-divider', own ? border : edge)
  if (own) (tokens as Record<string, string>)['color-connector'] = formatColor(edge)
  set('color-border', border)
  set('color-border-muted', withAlpha(border, 0.7))
  set('color-border-emphasis', edge)
  set('color-accent', accent)
  set('color-accent-emphasis', accent)
  set('color-accent-muted', fill(withAlpha(accent, 0.15)))
  set('color-focus', focus)
  set('color-highlight', fill(withAlpha(accent, dark ? 0.3 : 0.2)))
  // The token set's change colors and palette, moved only where the app's surfaces would break their contrast.
  const keep = (name: ThemeTokenName, value: Rgba) => {
    if (formatColor(value) !== formatColor(fallback(name))) set(name, value)
  }
  for (const hue of ['added', 'removed', 'modified', 'moved'] as const) {
    const base = ensureContrast(fallback(`color-${hue}`), [canvas, raised], 4.5, extreme, bg)
    keep(`color-${hue}`, base)
    keep(`color-${hue}-emphasis`, ensureContrast(fallback(`color-${hue}-emphasis`), [canvas, raised], 4.5, extreme, bg))
    keep(`color-${hue}-border`, ensureContrast(fallback(`color-${hue}-border`), [canvas, raised], 3, extreme, bg))
    keep(`color-${hue}-muted`, fill(fallback(`color-${hue}-muted`)))
    keep(`color-${hue}-highlight`, fill(fallback(`color-${hue}-highlight`)))
  }
  for (let index = 1; index <= 16; index++) {
    const name = `chart-${index}` as ThemeTokenName
    keep(name, ensureContrast(fallback(name), [bg], 3, extreme, bg))
  }
  const sans = fontList(colors.sans)
  const mono = fontList(colors.mono)
  if (sans) tokens['font-family'] = sans
  if (mono) tokens['font-family-mono'] = mono
  return validTokens(tokens)
}

/**
 * The default UI's `--pj-*` variables (theme.css) for a renderer token set, so a host that themes its stage
 * (`copilotCanvasThemeTokens`) gives its chrome the very same colors: the background is the
 * stage, wells and inputs inset, cards, popovers and segmented thumbs raised, hovers and bands the header surface,
 * text, rules, focus and the lens (accent) the tokens'. Tokens the set leaves out keep the token set's defaults for
 * `colorMode`; change colors are set only where the tokens moved them (theme.css keeps its own calibrated ones
 * otherwise).
 */
export function hostChromeVariables(
  tokens: Partial<Record<ThemeTokenName, string>>,
  colorMode: ColorMode,
): Record<`--pj-${string}`, string> {
  const all = {...defaultThemeTokens(colorMode), ...tokens}
  const t = (name: ThemeTokenName) => all[name]
  const variables: Record<`--pj-${string}`, string> = {
    '--pj-background': t('color-surface-canvas'),
    '--pj-foreground': t('color-fg'),
    '--pj-card': t('color-surface-raised'),
    '--pj-card-foreground': t('color-fg'),
    '--pj-popover': t('color-bg-overlay'),
    '--pj-popover-foreground': t('color-fg'),
    '--pj-primary': t('color-fg'),
    '--pj-primary-foreground': t('color-bg'),
    '--pj-secondary': t('color-surface-header'),
    '--pj-secondary-foreground': t('color-fg'),
    '--pj-muted': t('color-surface-inset'),
    '--pj-muted-foreground': t('color-fg-muted'),
    '--pj-accent': t('color-surface-header'),
    '--pj-accent-foreground': t('color-fg'),
    '--pj-border': t('color-border'),
    '--pj-input': t('color-border-emphasis'),
    // Controls (inputs, selects, checkboxes, slider tracks) keep a 3:1 boundary even where rules are an app's quiet ones.
    '--pj-control-border': (tokens as Record<string, string | undefined>)['color-connector'] ?? t('color-divider'),
    '--pj-ring': t('color-focus'),
    '--pj-lens': t('color-accent'),
    '--pj-lens-foreground': t('color-fg-on-emphasis'),
    '--pj-lens-muted': t('color-accent-muted'),
    '--pj-surface-canvas': t('color-surface-canvas'),
    '--pj-surface-raised': t('color-surface-raised'),
    '--pj-surface-header': t('color-surface-header'),
    '--pj-surface-inset': t('color-surface-inset'),
    '--pj-divider': t('color-divider'),
  }
  for (const hue of ['added', 'removed', 'modified', 'moved'] as const) {
    for (const suffix of ['', '-muted', '-border'] as const) {
      const name = `color-${hue}${suffix}` as ThemeTokenName
      if (tokens[name]) variables[`--pj-${hue}${suffix}`] = tokens[name]
    }
  }
  if (tokens['font-family']) variables['--pj-font-family'] = tokens['font-family']
  if (tokens['font-family-mono']) variables['--pj-font-family-mono'] = tokens['font-family-mono']
  return variables
}

/** A CSS color the browser accepts, as `#rrggbb(aa)`: painted on a pixel and read back. */
export function srgb(doc: Document, value: string): string | undefined {
  if (typeof CSS === 'undefined' || !CSS.supports('color', value)) return undefined
  const context = doc.createElement('canvas').getContext('2d', {willReadFrequently: true})
  if (!context) return undefined
  context.canvas.width = context.canvas.height = 1
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
  return formatColor({r: r!, g: g!, b: b!, a: a! / 255})
}

const black: Rgba = {r: 0, g: 0, b: 0, a: 1}
const white: Rgba = {r: 255, g: 255, b: 255, a: 1}
const opaque = (color: Rgba): Rgba => ({...color, a: 1})

/** The contrast steps between stacked surfaces, as the token set's defaults have them. */
const raisedStep = 1.1
const headerStep = 1.12
const insetStep = 1.03

/** `from` moved toward `toward` just far enough to differ by `ratio`, or as far as a quarter of the way. */
function step(from: Rgba, toward: Rgba, ratio: number): Rgba {
  for (let amount = 0.01; amount <= 0.25; amount += 0.01) {
    const candidate = mix(toward, from, amount)
    if (contrast(candidate, from) >= ratio) return candidate
  }
  return mix(toward, from, 0.25)
}

/** Text on emphasis fills (the accent, the change colors): the stage's color, else whichever extreme reads better. */
function onEmphasis(bg: Rgba, accent: Rgba): Rgba {
  if (contrast(bg, accent) >= 4.5) return bg
  return contrast(white, accent) >= contrast(black, accent) ? white : black
}

/** A font family list safe to send as a token: plain names and quoted names, no functions, braces or semicolons. */
export function fontList(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\s+/g, ' ')
  if (!text || text.length > rendererLimits.tokenLength) return undefined
  return isFontList(text) ? text : undefined
}

const quotedName = /^[^\\;{}<>]+$/
const plainNameCharacter = /[\w -]/

/**
 * Whether the text (spaces collapsed) is names separated by commas: each `"quoted"`, `'quoted'` (no backslashes,
 * semicolons, braces or angle brackets inside) or plain word characters, spaces and hyphens. One pass, so a long run
 * of spaces and commas can't make it backtrack.
 */
function isFontList(text: string): boolean {
  let index = 0
  for (;;) {
    let next = index
    while (text[next] === ' ') next++
    const quote = text[next]
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, next + 1)
      if (close < 0 || !quotedName.test(text.slice(next + 1, close))) return false
      index = close + 1
      while (text[index] === ' ') index++
    } else {
      // A plain name takes the spaces around it, and may be only spaces: `a, ,b` is three names.
      const start = index
      while (index < text.length && plainNameCharacter.test(text[index]!)) index++
      if (index === start) return false
    }
    if (index === text.length) return true
    if (text[index] !== ',') return false
    index++
  }
}

const known = new Set<string>([...themeTokenNames, ...optionalThemeTokenNames])
/** The overrides the token set and the renderer protocol accept: known names, colors that parse, values short enough. */
function validTokens(tokens: Partial<Record<ThemeTokenName, string>>): Partial<Record<ThemeTokenName, string>> {
  return Object.fromEntries(
    Object.entries(tokens).filter(
      ([name, value]) =>
        known.has(name) &&
        typeof value === 'string' &&
        value.length <= rendererLimits.tokenLength &&
        (!name.startsWith('color-') || parseColor(value) !== undefined),
    ),
  )
}
