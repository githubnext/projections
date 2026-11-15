// The GitHub Action reference, from action.yml.
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {parse as parseYaml} from 'yaml'
import {code, header, outDir, root, sentence, table, to} from './shared.mjs'

export async function action() {
  const manifest = parseYaml(await readFile(join(root, 'action.yml'), 'utf8'))
  const inputs = Object.entries(manifest.inputs ?? {})
  const outputs = Object.entries(manifest.outputs ?? {})
  const page = `${header(['action.yml'])}# GitHub Action reference

${sentence(manifest.description)} The Action is \`githubnext/projections\`, a ${manifest.runs.using} action; see
[Add Projections to CI](${to('docs/setup/ci.md')}) for how to set it up.

\`\`\`yaml
- uses: githubnext/projections@v0
  with:
    ${inputs[0][0]}: ${inputs[0][1].default === '' ? "''" : inputs[0][1].default}
\`\`\`

## Inputs

Every input is optional.

${table(
  ['Input', 'Default', 'Description'],
  inputs.map(([name, input]) => [
    code(name),
    input.default === '' || input.default === undefined ? '' : code(input.default),
    sentence(input.description),
  ]),
)}

## Outputs

${table(
  ['Output', 'Description'],
  outputs.map(([name, output]) => [code(name), sentence(output.description)]),
)}
`
  return {[`${outDir}/github-action.md`]: page}
}
