import {copilotCanvasThemeTokens, hostChromeVariables, readCopilotCanvasTheme} from '@githubnext/projections-host'
import type {InspectorHost, InspectorHostTheme} from '../host.js'

const chromeStyleId = 'pi-app-theme-chrome'

/**
 * Gives the chrome the stage's colors: one rule setting the default UI's `--pj-*` variables on every `.pj-root` under
 * `pi-app-theme` (portalled menus too), from the same tokens the renderer frames get. It lives outside the UI's
 * cascade layers, so it overrides theme.css; `undefined` removes it. The page's own stylesheet lives in `<head>`,
 * which the theme observer watches, so the rule is only rewritten when its text changes.
 */
function chromeStyle(doc: Document, variables: Record<string, string> | undefined) {
  let style = doc.getElementById(chromeStyleId)
  if (!variables) {
    style?.remove()
    return
  }
  const text = `.pi-app-theme .pj-root{${Object.entries(variables)
    .map(([name, value]) => `${name}:${value};`)
    .join('')}}`
  if (!style) {
    style = doc.createElement('style')
    style.id = chromeStyleId
    doc.head.append(style)
  }
  if (style.textContent !== text) style.textContent = text
}

/**
 * Gives the page an embedding app's theme, as renderer token overrides for its color mode (`copilotCanvasThemeTokens`,
 * `mcpAppThemeTokens`): marks the root `pi-app-theme` and gives the chrome the stage's colors, its bands (header,
 * toolbar, labels, summary bar) flat on the app's own color, so the page continues the app's surface; hovers and
 * wells keep the tokens' stepped surfaces. Returns the theme the Inspector follows; without an app theme, removes it
 * and returns `undefined`.
 */
export function applyAppTheme(
  doc: Document,
  app: {colorMode: 'light' | 'dark'; tokens: Readonly<{[name: string]: string}>} | undefined,
): InspectorHostTheme | undefined {
  doc.documentElement.classList.toggle('pi-app-theme', Boolean(app))
  if (!app) {
    chromeStyle(doc, undefined)
    return undefined
  }
  chromeStyle(doc, {...hostChromeVariables(app.tokens, app.colorMode), '--pj-surface-header': app.tokens['color-bg'] ?? ''})
  return {colorMode: app.colorMode, tokens: app.tokens}
}

/**
 * The page's theme: the GitHub Copilot app's, when the page is its canvas, else the system's. The app mirrors its theme
 * tokens onto the canvas document (`--background-color-default` and friends, `data-color-mode` on the root), maybe
 * after the page loads. While they are there the page marks its root `pi-app-theme` (styles.css maps the tokens onto
 * the chrome), follows the app's light or dark mode, and sends renderer frames the token overrides the app's variables
 * map to (`copilotCanvasThemeTokens`), so the stage is the app's too; otherwise the default themes follow
 * `prefers-color-scheme`. Both follow the app's theme as it changes.
 */
export function pageTheme(doc: Document = document): NonNullable<InspectorHost['theme']> {
  const root = doc.documentElement
  const dark = matchMedia('(prefers-color-scheme: dark)')
  const read = (): InspectorHostTheme => {
    const app = readCopilotCanvasTheme(doc, dark.matches)
    const applied = applyAppTheme(doc, app && {colorMode: app.colorMode, tokens: copilotCanvasThemeTokens(app.variables, app.colorMode)})
    if (applied) return applied
    const marked = root.getAttribute('data-color-mode') ?? doc.body?.getAttribute('data-color-mode')
    return {colorMode: marked === 'dark' || marked === 'light' ? marked : dark.matches ? 'dark' : 'light'}
  }
  let current = read()
  let key = JSON.stringify(current)
  // One observer for every subscriber: each hears every change.
  const listeners = new Set<() => void>()
  const changed = () => {
    const next = read()
    const nextKey = JSON.stringify(next)
    if (nextKey === key) return
    current = next
    key = nextKey
    for (const listener of [...listeners]) listener()
  }
  const observer = new MutationObserver(changed)
  const start = () => {
    observer.observe(root, {attributes: true, attributeFilter: ['data-color-mode', 'class', 'style']})
    // The app's stylesheet may be added, replaced or rewritten in place.
    observer.observe(doc.head, {childList: true, subtree: true, characterData: true})
    if (doc.body) observer.observe(doc.body, {attributes: true, attributeFilter: ['data-color-mode']})
    dark.addEventListener('change', changed)
  }
  return {
    get: () => current,
    subscribe(listener) {
      if (!listeners.size) {
        start()
        // The app may have mirrored its theme between the first read and the first subscriber.
        changed()
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size) return
        observer.disconnect()
        dark.removeEventListener('change', changed)
      }
    },
  }
}

/**
 * The color an app tints its header with to continue the page's top edge (`--status-bar-color`, which the Copilot
 * app reads after each load, resize and theme change): the viewer header's own, opaque.
 */
export function markStatusBar() {
  const header = document.querySelector('.pi-viewer-header')
  const color = header && getComputedStyle(header).backgroundColor
  const root = document.documentElement
  if (!color || /^rgba\(.*,\s*0(\.0+)?\)$|transparent/.test(color)) return
  if (root.style.getPropertyValue('--status-bar-color') !== color) root.style.setProperty('--status-bar-color', color)
}
