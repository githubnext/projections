import {useLayoutEffect, useState} from 'react'
import type {RefObject} from 'react'
import type {ThemeTokenName} from '@githubnext/projections-host'
import {vscodeColorMode, vscodeThemeKindOf} from './kinds.js'
import type {ColorMode, VscodeThemeKind} from './kinds.js'
import {vscodeVariableNames} from './variables.js'
import {vscodeThemeTokens} from './tokens.js'

/** Reads the `--vscode-*` variables the mapping uses at `element` (VS Code sets them on a webview's `html`). */
export function readVscodeVariables(
  element: Element = document.documentElement,
  names: readonly string[] = vscodeVariableNames,
): Record<string, string> {
  const style = getComputedStyle(element)
  const values: Record<string, string> = {}
  for (const name of names) {
    const value = style.getPropertyValue(name).trim()
    if (value) values[name] = value
  }
  return values
}

/** The nearest theme-marked element at `element` (a webview's `body`, or a Storybook frame), and its kind. */
function themeHolder(element: Element): {holder: Element | null; kind: VscodeThemeKind | undefined} {
  const holder =
    element.closest('.vscode-light, .vscode-dark, .vscode-high-contrast, .vscode-high-contrast-light') ?? bodyOf(element.ownerDocument)
  return {holder, kind: holder ? vscodeThemeKindOf(holder.classList) : undefined}
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

/** The VS Code theme at an element, from `useVscodeTheme` or `vscodeTheme`. */
export interface VscodeTheme {
  kind: VscodeThemeKind
  colorMode: ColorMode
  /** Whether VS Code's variables are present at the element (in a webview, or a frame that applies a theme). */
  vscode: boolean
  /** Undefined until the element mounts. */
  tokens: Record<ThemeTokenName, string> | undefined
}

/** The VS Code theme at an element: its kind (from the body classes) and the renderer tokens its variables resolve to. */
export function vscodeTheme(element: Element): Omit<VscodeTheme, 'tokens'> & {tokens: Record<ThemeTokenName, string>} {
  const variables = readVscodeVariables(element)
  const vscode = Object.keys(variables).length > 0
  const kind = themeHolder(element).kind ?? (prefersDark() ? 'dark' : 'light')
  return {kind, colorMode: vscodeColorMode(kind), vscode, tokens: vscodeThemeTokens(variables, kind)}
}

const sameTheme = (a: VscodeTheme, b: VscodeTheme) =>
  a.kind === b.kind && a.vscode === b.vscode && JSON.stringify(a.tokens) === JSON.stringify(b.tokens)

/**
 * The VS Code theme at an element, resolved before the first paint and again whenever VS Code changes theme: it
 * rewrites the variables on `html` and the kind classes on `body` (a frame's own theme holder is watched too), and
 * whenever the color scheme preference changes.
 */
export function useVscodeTheme(ref: RefObject<Element | null>): VscodeTheme {
  const [theme, setTheme] = useState<VscodeTheme>({kind: 'light', colorMode: 'light', vscode: false, tokens: undefined})
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const next = vscodeTheme(element)
      setTheme(previous => (sameTheme(previous, next) ? previous : next))
    }
    update()
    const observer = new MutationObserver(update)
    const watched = new Set([element.ownerDocument.documentElement, element.ownerDocument.body, themeHolder(element).holder])
    for (const node of watched) {
      if (node) {
        observer.observe(node, {attributes: true, attributeFilter: ['class', 'style', 'data-vscode-theme-kind', 'data-vscode-theme-id']})
      }
    }
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', update)
    }
  }, [ref])
  return theme
}

/** A document's body, which an XML document or one still loading hasn't got, whatever its type says. */
function bodyOf(document: Document): HTMLElement | null {
  return document.body
}
