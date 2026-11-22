import {defaultThemeTokens, themeTokenSetVersion, type ColorMode, type RendererTheme} from '@githubnext/projections-renderer-sdk/protocol'

/**
 * The host's default theme for a color mode: every token of the current
 * token set, with individual tokens overridden (for example by a design
 * system's values).
 */
export function hostTheme(colorMode: ColorMode, overrides: Record<string, string> = {}): RendererTheme {
  return {colorMode, version: themeTokenSetVersion, tokens: {...defaultThemeTokens(colorMode), ...overrides}}
}

/** Theme tokens as `--projections-<name>` CSS custom properties. */
export function themeStyle(theme: RendererTheme): Record<string, string> {
  return Object.fromEntries(Object.entries(theme.tokens).map(([name, value]) => [`--projections-${name}`, value]))
}
