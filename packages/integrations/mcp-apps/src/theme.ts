// The host's theme for the viewer: its light or dark mode and its standardized style variables (`--color-*`,
// `--font-*`, often `light-dark()` values), mapped onto renderer theme tokens (`mcpAppThemeTokens`) and the chrome's
// colors (`applyAppTheme`), as the Copilot app's canvas variables are. Without them, the default themes follow the
// host's mode, else the system's.
import {mcpAppThemeTokens, resolveMcpAppVariables} from '@githubnext/projections-host'
import {applyAppTheme} from '@githubnext/projections-inspector/viewer'
import type {InspectorHost, InspectorHostTheme} from '@githubnext/projections-inspector/mount'
import type {Host, HostContext} from './host.js'

const fontsStyleId = 'projections-host-fonts'

/** The host's font faces (`styles.css.fonts`), as hosts pass them for their families. */
function applyFonts(css: string | undefined) {
  let style = document.getElementById(fontsStyleId)
  if (!css) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = fontsStyleId
    document.head.append(style)
  }
  if (style.textContent !== css) style.textContent = css
}

/** The theme for a host context: applied to the page, and as the Inspector follows it. */
function themeFor(context: HostContext): InspectorHostTheme {
  const colorMode =
    context.theme === 'dark' || context.theme === 'light'
      ? context.theme
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
  // The page's own scheme is the host's, so `light-dark()` values, form controls and scrollbars follow it.
  document.documentElement.style.colorScheme = colorMode
  document.documentElement.dataset.colorMode = colorMode
  applyFonts(context.styles?.css?.fonts)
  const variables = resolveMcpAppVariables(document, context.styles?.variables ?? {}, colorMode)
  const tokens = mcpAppThemeTokens(variables, colorMode)
  return applyAppTheme(document, Object.keys(tokens).length ? {colorMode, tokens} : undefined) ?? {colorMode}
}

/** The Inspector's view of the host's theme, following its context. */
export function hostTheme(host: Host): NonNullable<InspectorHost['theme']> {
  let current = themeFor(host.context())
  let key = JSON.stringify(current)
  const listeners = new Set<() => void>()
  host.onContext(context => {
    const next = themeFor(context)
    const nextKey = JSON.stringify(next)
    if (nextKey === key) return
    current = next
    key = nextKey
    for (const listener of [...listeners]) listener()
  })
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
