// A theme seed: an embedding app's few colors and families for each color mode, given to a page per launch (the
// viewer's `?theme=`, `projections view --theme`) by an app that can't theme the page itself, such as an agent harness
// that shows the viewer in its own browser pane. It is the input of the app theme (app-theme.ts), which derives the
// rest, so it is a small, stable contract rather than the token set.

import type {ColorMode, ThemeTokenName} from '@githubnext/projections-renderer-sdk/protocol'
import {rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import {appThemeTokens, fontList} from './app-theme.js'
import {parseColor} from './color.js'

/** One color mode's seed: CSS colors as sRGB (`#rgb`, `#rrggbb(aa)`, `rgb()`, `rgba()`), families as font lists. */
export interface ThemeSeedColors {
  /** The app's surface the page sits on; required. */
  background: string
  text?: string
  muted?: string
  /** Rules and edges. */
  border?: string
  /** Selection, links and the lens; the focus ring when there is no `focus`. */
  accent?: string
  /** The focus ring; the accent when there is no `accent`. */
  focus?: string
  /** Font family names the page already has (a seed loads no fonts). */
  sans?: string
  mono?: string
}

/** An app's theme seed: one or both color modes. A mode the seed leaves out keeps the page's own theme. */
export interface ThemeSeed {
  light?: ThemeSeedColors
  dark?: ThemeSeedColors
}

/** The keys a mode's seed may have, colors then families. */
export const themeSeedKeys = ['background', 'text', 'muted', 'border', 'accent', 'focus', 'sans', 'mono'] as const

/** The longest seed accepted, as JSON text. */
export const themeSeedMaxLength = 4096

const colorModes = ['light', 'dark'] as const
const families = new Set<string>(['sans', 'mono'])

/** A seed, or why it isn't one. */
export type ThemeSeedResult = {seed: ThemeSeed; error?: undefined} | {seed?: undefined; error: string}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A theme seed from a parsed value, checked whole: an object with `light`, `dark` or both, each an object with a
 * `background` and only the other `themeSeedKeys`, every color one the app theme parses and every family a plain font
 * list, each at most the renderer protocol's token length. Anything else is refused with what is wrong, so a value
 * that reaches a page as CSS is only ever one of those.
 */
export function parseThemeSeed(value: unknown): ThemeSeedResult {
  if (!isRecord(value)) return {error: 'The theme must be an object with "light", "dark" or both'}
  const unknownMode = Object.keys(value).find(key => !(colorModes as readonly string[]).includes(key))
  if (unknownMode !== undefined) return {error: `The theme has "${unknownMode}"; it takes only "light" and "dark"`}
  const seed: ThemeSeed = {}
  for (const mode of colorModes) {
    const colors = value[mode]
    if (colors === undefined) continue
    if (!isRecord(colors)) return {error: `theme.${mode} must be an object`}
    const unknownKey = Object.keys(colors).find(key => !(themeSeedKeys as readonly string[]).includes(key))
    if (unknownKey !== undefined) return {error: `theme.${mode} has "${unknownKey}"; it takes ${themeSeedKeys.join(', ')}`}
    if (colors.background === undefined) return {error: `theme.${mode} needs a "background"`}
    const checked: Record<string, string> = {}
    for (const key of themeSeedKeys) {
      const text = colors[key]
      if (text === undefined) continue
      const at = `theme.${mode}.${key}`
      if (typeof text !== 'string') return {error: `${at} must be a string`}
      if (text.length > rendererLimits.tokenLength) return {error: `${at} is longer than ${rendererLimits.tokenLength} characters`}
      if (families.has(key)) {
        if (!fontList(text)) return {error: `${at} isn't a font family list: plain or quoted names, separated by commas`}
      } else if (!parseColor(text)) {
        return {error: `${at} isn't a color: use #rgb, #rrggbb, #rrggbbaa, rgb() or rgba()`}
      }
      checked[key] = text.trim()
    }
    seed[mode] = checked as unknown as ThemeSeedColors
  }
  if (!seed.light && !seed.dark) return {error: 'The theme must have "light", "dark" or both'}
  return {seed}
}

/** A theme seed from JSON text (`?theme=`, after the URL's own decoding), or why it isn't one. */
export function parseThemeSeedText(text: string): ThemeSeedResult {
  if (text.length > themeSeedMaxLength) return {error: `The theme is longer than ${themeSeedMaxLength} characters`}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return {error: "The theme isn't JSON; in a URL, percent-encode it (a # is %23)"}
  }
  return parseThemeSeed(value)
}

/** A seed as the compact JSON text `?theme=` takes, keys in contract order. */
export function formatThemeSeed(seed: ThemeSeed): string {
  const ordered: Record<string, Record<string, string>> = {}
  for (const mode of colorModes) {
    const colors = seed[mode] as Record<string, string | undefined> | undefined
    if (!colors) continue
    ordered[mode] = Object.fromEntries(themeSeedKeys.flatMap(key => (colors[key] === undefined ? [] : [[key, colors[key]]])))
  }
  return JSON.stringify(ordered)
}

/**
 * Renderer theme token overrides from a seed for `colorMode` (`appThemeTokens`, with the app's own rules), or
 * `undefined` when the seed leaves that mode out, so the page keeps its own theme in it.
 */
export function themeSeedTokens(seed: ThemeSeed, colorMode: ColorMode): Partial<Record<ThemeTokenName, string>> | undefined {
  const colors = seed[colorMode]
  // A seed is an app's own look, so its rules are drawn in its border as given (see `AppThemeRules`).
  return colors ? appThemeTokens(colors, colorMode, 'app') : undefined
}
