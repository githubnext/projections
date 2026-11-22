// The GitHub Copilot app's canvas theme for renderer frames: the app's documented canvas variables, and the app theme
// (app-theme.ts) they map to.

import type {ColorMode, ThemeTokenName} from '@githubnext/projections-renderer-sdk/protocol'
import {appThemeTokens, srgb} from './app-theme.js'
import {parseColor} from './color.js'

/**
 * The variables of the app's documented canvas theme contract the mapping reads (the app mirrors them onto a canvas
 * document's root, with `data-color-mode`). Nothing else the app sets is a contract, so nothing else is read.
 */
export const copilotCanvasVariableNames = [
  '--background-color-default',
  '--border-color-default',
  '--text-color-default',
  '--text-color-muted',
  '--color-focus-outline',
  '--true-color-blue',
  '--font-sans',
  '--font-mono',
] as const

/** Captured values of the app's canvas variables, by name; a missing or empty one keeps the token set's default. */
export type CopilotCanvasVariables = Readonly<Partial<Record<string, string>>>

/** The app's theme at a canvas document: its color mode and its variables, colors as sRGB hex. */
export interface CopilotCanvasTheme {
  colorMode: ColorMode
  variables: CopilotCanvasVariables
}

/**
 * Renderer theme token overrides from the app's canvas variables (`appThemeTokens`): the stage is
 * `--background-color-default`, text and muted text `--text-color-default` and `--text-color-muted`, rules
 * `--border-color-default` as the app draws it (its links and controls keep 3:1), the accent and focus ring `--color-focus-outline` (else `--true-color-blue`), and the
 * families `--font-sans` and `--font-mono`. Without `--background-color-default` there is no app theme, and no
 * overrides.
 */
export function copilotCanvasThemeTokens(variables: CopilotCanvasVariables, colorMode: ColorMode): Partial<Record<ThemeTokenName, string>> {
  const accent = [variables['--color-focus-outline'], variables['--true-color-blue']].find(value => parseColor(value?.trim()))
  return appThemeTokens(
    {
      background: variables['--background-color-default'],
      text: variables['--text-color-default'],
      muted: variables['--text-color-muted'],
      border: variables['--border-color-default'],
      focus: variables['--color-focus-outline'],
      accent,
      sans: variables['--font-sans'],
      mono: variables['--font-mono'],
    },
    colorMode,
    // The canvas's rules and card edges are the app's own divider, as its panes draw it; links and controls keep 3:1.
    'app',
  )
}

/**
 * The app's canvas theme at a document, or `undefined` while the app hasn't mirrored it (a page in a browser): the
 * root's (else the body's) `data-color-mode` and the contract's variables as computed on the root. Colors in forms
 * the mapping doesn't parse (`oklch()`, `color()`, names) are resolved to sRGB by the browser first.
 */
export function readCopilotCanvasTheme(doc: Document, prefersDark = false): CopilotCanvasTheme | undefined {
  const root = doc.documentElement
  const style = getComputedStyle(root)
  if (!style.getPropertyValue('--background-color-default').trim()) return undefined
  const marked = root.getAttribute('data-color-mode') ?? (doc.body as HTMLElement | null)?.getAttribute('data-color-mode')
  const colorMode: ColorMode = marked === 'dark' || marked === 'light' ? marked : prefersDark ? 'dark' : 'light'
  const variables: Record<string, string> = {}
  for (const name of copilotCanvasVariableNames) {
    const value = style.getPropertyValue(name).trim()
    if (!value) continue
    variables[name] = name.startsWith('--font-') || parseColor(value) ? value : (srgb(doc, value) ?? value)
  }
  return {colorMode, variables}
}
