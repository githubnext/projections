// The VS Code UI's story frame: a VS Code theme captured from VS Code itself (packages/host/vscode-ui/fixtures/themes), applied as a
// webview receives it (its `--vscode-*` variables and theme kind classes), with the VS Code UI's stylesheet and codicons.
import type {CSSProperties, ReactNode} from 'react'
import type {Decorator} from '@storybook/react-vite'
import {ensureCodiconStylesheet} from '@githubnext/projections-host-vscode'
import type {VscodeThemeFixture} from '@githubnext/projections-host-vscode'
import '@githubnext/projections-host-vscode/styles.css'
import {asset} from './runtime.js'
import './frame.css'

const captured = import.meta.glob<VscodeThemeFixture>('../../../packages/host/vscode-ui/fixtures/themes/*.json', {
  eager: true,
  import: 'default',
})
const order = ['dark-modern', 'light-modern', 'dark-high-contrast', 'light-high-contrast', 'solarized-dark', 'dark-2026']

/** The representative VS Code themes, in the theme switcher's order. */
export const vscodeThemes: readonly VscodeThemeFixture[] = Object.values(captured).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))

export const vscodeThemeOf = (globals: Record<string, unknown>): VscodeThemeFixture =>
  vscodeThemes.find(theme => theme.id === globals.vscodeTheme) ?? vscodeThemes[0]!

/** The element a webview's `html` and `body` would be: the theme's variables and kind classes, drawn on its editor background. */
export function VscodeThemeFrame({theme, className, children}: {theme: VscodeThemeFixture; className?: string; children: ReactNode}) {
  ensureCodiconStylesheet(asset('codicons/codicon.css').href)
  return (
    <div
      className={`sb-vscode-frame ${theme.bodyClasses.join(' ')} ${className ?? ''}`}
      style={theme.variables as CSSProperties}
      data-vscode-theme={theme.id}
      data-vscode-theme-kind={theme.bodyClasses.at(-1)}
    >
      {children}
    </div>
  )
}

export const withVscodeFrame: Decorator = (Story, {globals}) => (
  <VscodeThemeFrame theme={vscodeThemeOf(globals)} className="sb-frame">
    <Story />
  </VscodeThemeFrame>
)
