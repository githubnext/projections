// Casing rule: data appears exactly as the data has it, and human text is written in sentence case, so no style may
// recase text. Fails on text-transform: uppercase or capitalize, and on small caps, in every UI tree's styles (CSS
// files and inline styles in TypeScript): renderers, hosts, the Inspector, the VS Code extension, Storybook, the
// renderer examples and the renderer template.
import {readFile, readdir} from 'node:fs/promises'
import {extname, join, relative, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const trees = [
  'packages/renderers',
  'packages/host/core/src',
  'packages/host/vscode-ui/src',
  'packages/host/inspector/src',
  'packages/integrations/vscode/src',
  'tools/storybook',
  'examples/renderers',
  'packages/cli/templates/renderer',
]
// Files that recase text on purpose, relative to the root.
const exempt = new Set([
  // A deliberately hostile embedding page: the host's browser suite checks that its styles don't reach a view.
  'tools/storybook/harness/host/embed.css',
])
const ignored = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', '.cache', 'storybook-static'])
const extensions = new Set(['.css', '.ts', '.tsx'])
const recasing = [
  /text-transform\s*:\s*(uppercase|capitalize)/iu,
  /textTransform\s*:\s*['"](uppercase|capitalize)['"]/u,
  /font-variant(-caps)?\s*:[^;]*small-caps/iu,
  /fontVariant(Caps)?\s*:\s*['"][^'"]*small-caps/u,
]
const failures = []
let files = 0

async function visit(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (ignored.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await visit(path)
      continue
    }
    if (!extensions.has(extname(entry.name)) || /\.(?:spec|test)\.tsx?$/u.test(entry.name)) continue
    if (exempt.has(relative(root, path).split(sep).join('/'))) continue
    files++
    const lines = (await readFile(path, 'utf8')).split('\n')
    lines.forEach((line, index) => {
      if (recasing.some(pattern => pattern.test(line))) failures.push(`${relative(root, path)}:${index + 1}: ${line.trim()}`)
    })
  }
}

for (const tree of trees) await visit(join(root, tree))
if (failures.length) {
  throw new Error(
    `Styles must not recase text (show data verbatim; write human text in sentence case; quiet a label with the type scale and muted tone):\n${failures.join('\n')}`,
  )
}
console.log(`Casing: ${files} UI style and source files recase no text`)
