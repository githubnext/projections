// An MCP Apps host's theme for renderer frames: the standardized style variables a host passes in its host context
// (`hostContext.styles.variables`, SEP-1865), and the app theme (app-theme.ts) they map to.

import type {ColorMode, ThemeTokenName} from '@githubnext/projections-renderer-sdk/protocol'
import {appThemeTokens, srgb} from './app-theme.js'
import {parseColor} from './color.js'

/**
 * The standardized MCP Apps style variables the mapping reads. Hosts may pass any subset; a missing one keeps the
 * token set's default.
 */
export const mcpAppVariableNames = [
  '--color-background-primary',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-border-primary',
  '--color-ring-primary',
  '--color-text-info',
  '--font-sans',
  '--font-mono',
] as const

/** A host's style variables, by name, as its host context passes them (colors may use `light-dark()`). */
export type McpAppVariables = Readonly<Partial<Record<string, string | undefined>>>

/**
 * The side of a `light-dark(light, dark)` value for `colorMode`, as hosts write theme-aware values; any other value
 * as it is.
 */
export function lightDark(value: string | undefined, colorMode: ColorMode): string | undefined {
  const text = value?.trim()
  const inner = text && /^light-dark\((.*)\)$/is.exec(text)?.[1]
  if (!inner) return text
  let depth = 0
  for (let index = 0; index < inner.length; index++) {
    const character = inner[index]
    if (character === '(') depth++
    else if (character === ')') depth--
    else if (character === ',' && depth === 0) return (colorMode === 'dark' ? inner.slice(index + 1) : inner.slice(0, index)).trim()
  }
  return undefined
}

/**
 * Renderer theme token overrides from a host's MCP Apps style variables (`appThemeTokens`): the stage is
 * `--color-background-primary`, text and muted text `--color-text-primary` and `--color-text-secondary`, rules
 * `--color-border-primary`, the focus ring and accent `--color-ring-primary` (the accent else `--color-text-info`), and
 * the families `--font-sans` and `--font-mono`. `light-dark()` values take the side for `colorMode`. Without
 * `--color-background-primary` there is no host theme, and no overrides.
 */
export function mcpAppThemeTokens(variables: McpAppVariables, colorMode: ColorMode): Partial<Record<ThemeTokenName, string>> {
  const value = (name: (typeof mcpAppVariableNames)[number]) => lightDark(variables[name], colorMode)
  const accent = [value('--color-ring-primary'), value('--color-text-info')].find(candidate => parseColor(candidate))
  return appThemeTokens(
    {
      background: value('--color-background-primary'),
      text: value('--color-text-primary'),
      muted: value('--color-text-secondary'),
      border: value('--color-border-primary'),
      focus: value('--color-ring-primary'),
      accent,
      sans: variables['--font-sans'],
      mono: variables['--font-mono'],
    },
    colorMode,
  )
}

/**
 * A host's style variables with their colors as sRGB for `colorMode`: `light-dark()` resolved to its side, and forms
 * the mapping doesn't parse (`oklch()`, `color()`, names) resolved by the browser. Families and values the browser
 * doesn't take as colors are kept as they are.
 */
export function resolveMcpAppVariables(doc: Document, variables: McpAppVariables, colorMode: ColorMode): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const name of mcpAppVariableNames) {
    const raw = variables[name]
    if (typeof raw !== 'string' || !raw.trim()) continue
    if (name.startsWith('--font-')) {
      resolved[name] = raw.trim()
      continue
    }
    const value = lightDark(raw, colorMode)
    if (!value) continue
    resolved[name] = parseColor(value) ? value : (srgb(doc, value) ?? value)
  }
  return resolved
}
