// Writes THIRD_PARTY_NOTICES.md: the licences of the third-party packages the VS Code UI bundles into a browser app
// (VSCode Elements and Lit, MIT and BSD-3-Clause) and the codicons it draws (font and icons CC BY 4.0, code MIT).
//   node scripts/notices.mjs           writes the file
//   node scripts/notices.mjs --check   fails when the file is out of date
import {readdirSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {runtimeDependencies} from '@githubnext/projections-host/build/ui-notices'

const manifest = fileURLToPath(new URL('../package.json', import.meta.url))
const output = new URL('../THIRD_PARTY_NOTICES.md', import.meta.url)

const sections = [
  '# Third-party notices',
  '',
  'The VS Code UI (`@githubnext/projections-host-vscode`) bundles or ships the following third-party software. ' +
    'Apps that bundle this package should include these notices with their own.',
  '',
  'Codicons (`@vscode/codicons`) is dual-licensed: the icon font and the icon artwork (`codicon.ttf`, the SVGs that ' +
    '`src/icons.generated.ts` embeds as renderer icon tokens) are licensed under Creative Commons Attribution 4.0 ' +
    'International (CC BY 4.0), and the code (`codicon.css`) under the MIT License, both Copyright (c) Microsoft ' +
    'Corporation. The icons are used unmodified except for scaling, and one custom glyph (the modified tilde) is drawn ' +
    'in their style.',
]
for (const [name, path] of await runtimeDependencies(manifest)) {
  const json = JSON.parse(await readFile(path, 'utf8'))
  const directory = dirname(path)
  const files = readdirSync(directory)
    .filter(file => /^licen[cs]e(?:-code)?(?:\.(?:md|txt))?$/iu.test(file))
    .sort()
  sections.push('', `## ${name} ${json.version} (${json.license})`, '')
  if (!files.length) {
    const author = typeof json.author === 'string' ? json.author : json.author?.name
    sections.push(
      `${json.license} License${author ? `, Copyright (c) ${author}` : ''}. The package ships no license file; see https://spdx.org/licenses/${json.license}.html.`,
    )
  }
  for (const file of files) {
    if (files.length > 1) sections.push(`### ${file}`, '')
    sections.push(
      '```text',
      (await readFile(join(directory, file), 'utf8'))
        .replace(/^\uFEFF/u, '')
        .replace(/\r\n?/gu, '\n')
        .trimEnd(),
      '```',
    )
    if (file !== files.at(-1)) sections.push('')
  }
}
const text = `${sections.join('\n').trimEnd()}\n`
if (process.argv.includes('--check')) {
  const current = await readFile(output, 'utf8').catch(() => '')
  if (current !== text) {
    throw new Error('THIRD_PARTY_NOTICES.md is out of date: run npm run notices --workspace @githubnext/projections-host-vscode')
  }
} else await writeFile(output, text)
