import {
  copilotCanvasThemeTokens,
  hostChromeVariables,
  parseThemeSeedText,
  readCopilotCanvasTheme,
  themeSeedTokens,
  type ThemeSeed,
  type ThemeSeedResult,
} from '@githubnext/projections-host'
import type {InspectorHost, InspectorHostTheme} from '../host.js'

const chromeStyleId = 'pi-app-theme-chrome'

type ColorMode = 'light' | 'dark'
type Tokens = Readonly<Record<string, string>>

/**
 * Gives the chrome the stage's colors: one rule for each color mode the theme colors, setting the default UI's `--pj-*`
 * variables on every `.pj-root` of that mode under `pi-app-theme` (portalled menus too), from the same tokens the
 * renderer frames get, so a mode it doesn't color (the person chose the other one) keeps the default theme's chrome as
 * its stage does. It lives outside the UI's cascade layers, so it overrides theme.css; no modes removes it. The page's
 * own stylesheet lives in `<head>`, which the theme observer watches, so the rule is only rewritten when its text
 * changes.
 */
function chromeStyle(doc: Document, modes: Partial<Record<ColorMode, Record<string, string>>>) {
  let style = doc.getElementById(chromeStyleId)
  const rules = Object.entries(modes).map(
    ([mode, variables]) =>
      `.pi-app-theme .pj-root[data-color-mode='${mode}']{${Object.entries(variables)
        .map(([name, value]) => `${name}:${value};`)
        .join('')}}`,
  )
  if (!rules.length) {
    style?.remove()
    return
  }
  const text = rules.join('')
  if (!style) {
    style = doc.createElement('style')
    style.id = chromeStyleId
    doc.head.append(style)
  }
  if (style.textContent !== text) style.textContent = text
}

/** The chrome's variables for one mode's tokens: the stage's, its bands flat on the app's own color. */
const chromeVariables = (tokens: Tokens, colorMode: ColorMode) => ({
  ...hostChromeVariables(tokens, colorMode),
  '--pj-surface-header': tokens['color-bg'] ?? '',
})

/**
 * Gives the page an embedding app's theme, as renderer token overrides for its color mode (`copilotCanvasThemeTokens`,
 * `themeSeedTokens`) and, where the app has them, for the other mode (`modes`, a theme seed's):
 * marks the root `pi-app-theme` and gives the chrome the stage's colors, its bands (header, toolbar, labels, summary
 * bar) flat on the app's own color, so the page continues the app's surface; hovers and wells keep the tokens' stepped
 * surfaces. Returns the theme the Inspector follows; without an app theme, removes it and returns `undefined`.
 */
export function applyAppTheme(
  doc: Document,
  app: {colorMode: ColorMode; tokens?: Tokens | undefined; modes?: Partial<Record<ColorMode, Tokens>> | undefined} | undefined,
): InspectorHostTheme | undefined {
  const modes: Partial<Record<ColorMode, Tokens>> = {...app?.modes}
  if (app?.tokens) modes[app.colorMode] = app.tokens
  const themed = Object.keys(modes).length > 0
  doc.documentElement.classList.toggle('pi-app-theme', themed)
  chromeStyle(doc, Object.fromEntries(Object.entries(modes).map(([mode, tokens]) => [mode, chromeVariables(tokens, mode as ColorMode)])))
  if (!app || !themed) return undefined
  const others = Object.fromEntries(Object.entries(modes).filter(([mode]) => mode !== app.colorMode))
  return {
    colorMode: app.colorMode,
    ...(app.tokens ? {tokens: app.tokens} : {}),
    ...(Object.keys(others).length ? {modes: others} : {}),
  }
}

/** A theme seed in the page URL's `?theme=` (`projections view --theme`), or why it was ignored; nothing without one. */
export function urlThemeSeed(search: string = location.search): ThemeSeedResult | undefined {
  const text = new URLSearchParams(search).get('theme')
  return text === null ? undefined : parseThemeSeedText(text)
}

/**
 * The viewer page's theme: the host's when it gives one (an embedding host's `host.theme`), else the page's own
 * (`pageTheme`), with the theme seed in its URL. Says what the page reports of the seed, and the notice for one it ignored.
 */
export function viewerTheme(hostTheme: InspectorHost['theme']): {
  theme: NonNullable<InspectorHost['theme']>
  report?: {seeded: true} | {ignored: string}
  notice?: {notice: string; noticeDetail: string}
} {
  if (hostTheme) return {theme: hostTheme}
  const seed = urlThemeSeed()
  const theme = pageTheme(document, seed?.seed)
  if (!seed) return {theme}
  if (seed.seed) return {theme, report: {seeded: true}}
  return {
    theme,
    report: {ignored: seed.error},
    notice: {notice: "This link's theme isn't valid, so the page keeps its own", noticeDetail: seed.error},
  }
}

/**
 * The page's theme: a theme seed's (`?theme=`), in the color modes it colors; else the GitHub Copilot app's, when the
 * page is its canvas; else the system's. The app mirrors its theme tokens onto the canvas document
 * (`--background-color-default` and friends, `data-color-mode` on the root), maybe after the page loads. While a theme
 * is there the page marks its root `pi-app-theme` (the chrome takes its colors), follows the app's light or dark mode,
 * and sends renderer frames the token overrides the seed or the app's variables map to (`themeSeedTokens`,
 * `copilotCanvasThemeTokens`), so the stage is the app's too; otherwise the default themes follow
 * `prefers-color-scheme`. A seed decides only colors: the color mode is still the app's, else the system's. All of it
 * follows the app's theme as it changes.
 */
export function pageTheme(doc: Document = document, seed?: ThemeSeed): NonNullable<InspectorHost['theme']> {
  const root = doc.documentElement
  const dark = matchMedia('(prefers-color-scheme: dark)')
  const seeded: Partial<Record<ColorMode, Tokens>> = {}
  for (const mode of ['light', 'dark'] as const) {
    const tokens = seed && themeSeedTokens(seed, mode)
    if (tokens) seeded[mode] = tokens
  }
  const read = (): InspectorHostTheme => {
    const app = readCopilotCanvasTheme(doc, dark.matches)
    const marked = root.getAttribute('data-color-mode') ?? (doc.body as HTMLElement | null)?.getAttribute('data-color-mode')
    const colorMode: ColorMode = app?.colorMode ?? (marked === 'dark' || marked === 'light' ? marked : dark.matches ? 'dark' : 'light')
    const tokens = seeded[colorMode] ?? (app && copilotCanvasThemeTokens(app.variables, app.colorMode))
    return applyAppTheme(doc, {colorMode, tokens, modes: seeded}) ?? {colorMode}
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
    for (const listener of Array.from(listeners)) listener()
  }
  const observer = new MutationObserver(changed)
  const start = () => {
    observer.observe(root, {attributes: true, attributeFilter: ['data-color-mode', 'class', 'style']})
    // The app's stylesheet may be added, replaced or rewritten in place.
    observer.observe(doc.head, {childList: true, subtree: true, characterData: true})
    const body = doc.body as HTMLElement | null
    if (body) observer.observe(body, {attributes: true, attributeFilter: ['data-color-mode']})
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
  if (!color || /^rgba\(.*,\s*0(?:\.0+)?\)$|transparent/u.test(color)) return
  if (root.style.getPropertyValue('--status-bar-color') !== color) root.style.setProperty('--status-bar-color', color)
}
