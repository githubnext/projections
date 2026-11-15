/** Whether a theme is light or dark, as the host and renderers take it; `vscodeColorMode` maps a theme kind to it. */
export type ColorMode = 'light' | 'dark'
/** VS Code's theme kinds, as its webviews mark `body`: `vscode-light`, `vscode-dark`, `vscode-high-contrast` and `vscode-high-contrast-light`. */
export type VscodeThemeKind = 'light' | 'dark' | 'high-contrast' | 'high-contrast-light'
/** `--vscode-*` variables by name, for example `{'--vscode-editor-background': '#1f1f1f'}`. */
export type VscodeVariables = Readonly<Record<string, string>>

/** The theme kind marked by a webview's body classes (or any element's classes, for example a Storybook frame). */
export function vscodeThemeKindOf(classes: Iterable<string>): VscodeThemeKind | undefined {
  const names = new Set(classes)
  if (names.has('vscode-high-contrast-light')) return 'high-contrast-light'
  if (names.has('vscode-high-contrast')) return 'high-contrast'
  if (names.has('vscode-dark')) return 'dark'
  if (names.has('vscode-light')) return 'light'
  return undefined
}

/** A theme kind's color mode: high contrast is dark, high contrast light is light. */
export const vscodeColorMode = (kind: VscodeThemeKind): ColorMode => (kind === 'light' || kind === 'high-contrast-light' ? 'light' : 'dark')
/** Whether a theme kind is one of VS Code's high contrast themes. */
export const isHighContrast = (kind: VscodeThemeKind) => kind === 'high-contrast' || kind === 'high-contrast-light'
