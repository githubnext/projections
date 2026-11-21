// Screenshots of a comparator file in real VS Code, Dark Modern and Light Modern (1440×1120, the whole file):
// the CEL in its values highlighted by what each name is, with the pointer on a call and its hover open, for
// docs/design/images/.
//   node scripts/screenshots/rules-screenshots.mjs [output directory]
import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createDemoRepository} from '../../test/smoke/demo-repo.mjs'
import {cli, launch} from './electron.mjs'

const output = process.argv[2] ?? fileURLToPath(new URL('../../../../../docs/design/images/', import.meta.url))
const name = 'moved-components.comparator.yaml'
const source = await readFile(new URL(`../../../../../examples/comparators/moved-components/${name}`, import.meta.url), 'utf8')
const shots = [
  // A library function's signature and documentation.
  {file: 'rules-editor-dark', theme: 'Default Dark Modern', kind: 'dark', line: "graph.entity('after'", token: 'entity'},
  // The file's own function: its parameters, result and description.
  {file: 'rules-editor-light', theme: 'Default Light Modern', kind: 'light', line: "key: '[item.kind, moved(", token: 'moved'},
]
const repository = await createDemoRepository(cli)
await writeFile(join(repository, 'tools', name), source)
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
for (const shot of shots) {
  const {app, window} = await launch({repository, theme: shot.theme, kind: shot.kind, height: 1120})
  try {
    await window.keyboard.press(`${modifier}+P`)
    await window.locator('.quick-input-widget input').fill(name)
    await window.locator('.quick-input-list .monaco-list-row', {hasText: name}).first().waitFor()
    await window.keyboard.press('Enter')
    await window.locator('.monaco-editor .view-lines').first().waitFor()
    // Semantic tokens arrive once the language service has read the file.
    await new Promise(resolve => {
      setTimeout(resolve, 3000)
    })
    await window
      .locator('.view-line', {hasText: shot.line})
      .locator('span span', {hasText: new RegExp(`^${shot.token}$`)})
      .first()
      .hover()
    await window.locator('.monaco-hover:not(.hidden) .rendered-markdown').first().waitFor({timeout: 30_000})
    await new Promise(resolve => {
      setTimeout(resolve, 800)
    })
    await window.screenshot({path: join(output, `${shot.file}.png`)})
    console.log(shot.file)
  } finally {
    await app.close()
  }
}
