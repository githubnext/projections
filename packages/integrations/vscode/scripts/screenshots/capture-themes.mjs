// Captures the CSS variables real VS Code injects into a webview (`--vscode-*` on the root element, the body's theme
// classes) for representative color themes, as host-vscode's Storybook and test fixtures, and a screenshot of each.
//   node scripts/screenshots/capture-themes.mjs [output directory]
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createDemoRepository} from '../../test/smoke/demo-repo.mjs'
import {cli, command, inspectorFrame, launch} from './electron.mjs'

export const themes = [
  {id: 'dark-modern', name: 'Default Dark Modern', kind: 'dark'},
  {id: 'light-modern', name: 'Default Light Modern', kind: 'light'},
  {id: 'dark-high-contrast', name: 'Default High Contrast', kind: 'hc-dark'},
  {id: 'light-high-contrast', name: 'Default High Contrast Light', kind: 'hc-light'},
  {id: 'solarized-dark', name: 'Solarized Dark', kind: 'dark'},
  {id: 'dark-2026', name: 'Dark 2026', kind: 'dark'},
]
const output = process.argv[2] ?? fileURLToPath(new URL('../../../../host/vscode-ui/fixtures/themes/', import.meta.url))
const repository = await createDemoRepository(cli)
const only = process.argv[3]?.split(',')
for (const theme of themes.filter(item => !only || only.includes(item.id))) {
  const {app, window} = await launch({repository, theme: theme.name, kind: theme.kind})
  try {
    await command(window, 'Projections: Open Inspector')
    const frame = await inspectorFrame(window)
    const captured = await frame.evaluate(() => {
      const style = document.documentElement.style
      const variables = {}
      for (const name of style) {
        if (name.startsWith('--vscode-')) variables[name] = style.getPropertyValue(name).trim()
      }
      return {
        bodyClasses: [...document.body.classList].filter(name => name.startsWith('vscode-')),
        themeKind: document.body.dataset.vscodeThemeKind,
        themeName: document.body.dataset.vscodeThemeName,
        variables,
      }
    })
    const sorted = Object.fromEntries(Object.entries(captured.variables).sort(([a], [b]) => a.localeCompare(b)))
    await writeFile(
      join(output, `${theme.id}.json`),
      `${JSON.stringify({id: theme.id, name: captured.themeName, setting: theme.name, kind: theme.kind, source: `VS Code ${await app.evaluate(({app}) => app.getVersion())}, webview-injected CSS`, bodyClasses: captured.bodyClasses, themeKind: captured.themeKind, variables: sorted}, null, 2)}\n`,
    )
    await new Promise(resolve => setTimeout(resolve, 6000))
    await window.screenshot({path: join(output, `${theme.id}.vscode.png`)})
    console.log(theme.id, Object.keys(sorted).length, 'variables')
  } finally {
    await app.close()
  }
}
