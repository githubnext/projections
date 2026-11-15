// VS Code's look and motion preferences, as the page reads them from the workbench's classes and variables.
import type {InspectorHost, InspectorHostTheme} from '@githubnext/projections-inspector/mount'

/** VS Code's color theme: `vscode-light`, `vscode-dark` and the high-contrast variants on `body`, and its focus color. */
export function vscodeTheme(): NonNullable<InspectorHost['theme']> {
  const read = (): InspectorHostTheme => {
    const classes = document.body.classList
    const dark =
      classes.contains('vscode-dark') || (classes.contains('vscode-high-contrast') && !classes.contains('vscode-high-contrast-light'))
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--vscode-focusBorder').trim()
    return {colorMode: dark ? 'dark' : 'light', ...(accent ? {accent} : {})}
  }
  let current = read()
  const listeners = new Set<() => void>()
  new MutationObserver(() => {
    const next = read()
    if (next.colorMode === current.colorMode && next.accent === current.accent) return
    current = next
    for (const listener of listeners) listener()
  }).observe(document.body, {attributes: true, attributeFilter: ['class']})
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** VS Code's reduce motion (its `workbench.reduceMotion`, `auto` following the system's) or the system's. */
export const reducedMotion = () =>
  document.body.classList.contains('vscode-reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches
