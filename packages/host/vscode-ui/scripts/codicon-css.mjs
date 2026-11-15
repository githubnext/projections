// Copies the codicon font and its stylesheet (@vscode/codicons: the font CC BY 4.0, the CSS MIT, Copyright (c) Microsoft
// Corporation; see THIRD_PARTY_NOTICES.md) into dist/codicons/, for pages to link as `vscode-codicon-stylesheet`, which
// `vscode-icon` and the codicon classes read.
//   node scripts/codicon-css.mjs
import {copyFile, mkdir} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname, join} from 'node:path'

const require = createRequire(import.meta.url)
const source = join(dirname(require.resolve('@vscode/codicons/package.json')), 'dist')
const target = new URL('../dist/codicons/', import.meta.url)
await mkdir(target, {recursive: true})
for (const name of ['codicon.css', 'codicon.ttf']) await copyFile(join(source, name), new URL(name, target))
