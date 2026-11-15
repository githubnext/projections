import type {VscodeThemeKind} from './theme/kinds.js'

/** A VS Code color theme as a webview receives it (`fixtures/themes/*.json`, captured from VS Code). */
export interface VscodeThemeFixture {
  id: string
  /** The theme's name, for example "Dark Modern". */
  name: string
  kind: 'light' | 'dark' | 'hc-dark' | 'hc-light'
  /** The classes VS Code puts on a webview's `body`, for example `vscode-dark`. */
  bodyClasses: readonly string[]
  /** Every `--vscode-*` variable VS Code sets on a webview's `html`. */
  variables: Readonly<Record<string, string>>
}

/** The `body` classes VS Code gives a webview for each theme kind. */
export const vscodeThemeClasses: Readonly<Record<VscodeThemeKind, readonly string[]>> = {
  light: ['vscode-light'],
  dark: ['vscode-dark'],
  'high-contrast': ['vscode-high-contrast'],
  'high-contrast-light': ['vscode-high-contrast', 'vscode-high-contrast-light'],
}
const allClasses = [...new Set(Object.values(vscodeThemeClasses).flat())]

/**
 * Applies a VS Code theme to `element` as VS Code applies one to a webview: its variables as inline custom properties
 * and its kind classes, replacing a theme applied before. For pages outside VS Code, such as Storybook and tests.
 */
export function applyVscodeTheme(element: HTMLElement, theme: Pick<VscodeThemeFixture, 'bodyClasses' | 'variables'>) {
  for (const name of [...element.style]) if (name.startsWith('--vscode-')) element.style.removeProperty(name)
  for (const [name, value] of Object.entries(theme.variables)) element.style.setProperty(name, value)
  element.classList.remove(...allClasses)
  element.classList.add(...theme.bodyClasses)
  element.setAttribute('data-vscode-theme-kind', theme.bodyClasses.at(-1)!)
}

/**
 * Links the codicon stylesheet at `href` as `vscode-codicon-stylesheet`, which `vscode-icon` reads, unless the
 * document already has one. Returns the link.
 */
export function ensureCodiconStylesheet(href: string, document: Document = globalThis.document): HTMLLinkElement {
  const existing = document.getElementById('vscode-codicon-stylesheet')
  if (existing instanceof HTMLLinkElement) return existing
  const link = document.createElement('link')
  link.id = 'vscode-codicon-stylesheet'
  link.rel = 'stylesheet'
  link.href = href
  document.head.append(link)
  return link
}
