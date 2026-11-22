// Inlines a stylesheet's leading `@import './part.css';` lines, so a webview loads one file. The VS Code UI's
// styles.css imports parts cut from one stylesheet at its blank lines; one blank line rejoins them.
import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'

export async function inlineImports(path) {
  const source = await readFile(path, 'utf8')
  const imports = [...source.matchAll(/^@import '([^']+)';\n/gmu)]
  if (!imports.length) return source
  const start = imports[0].index
  const end = imports.at(-1).index + imports.at(-1)[0].length
  if (source.slice(start, end) !== imports.map(match => match[0]).join('')) throw new Error(`${path}: imports must be consecutive`)
  const parts = await Promise.all(imports.map(match => readFile(new URL(match[1], pathToFileURL(path)), 'utf8')))
  return source.slice(0, start) + parts.join('\n') + source.slice(end)
}
