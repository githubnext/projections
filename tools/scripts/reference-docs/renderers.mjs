// The built-in renderers reference, from their manifests and scenarios.
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {builtRenderers, code, exists, header, outDir, root, sentence, table, to} from './shared.mjs'

export async function renderers() {
  const found = await builtRenderers()
  // Each renderer's fixture scenarios (scenarios.json), the examples its gallery and browser checks show.
  for (const renderer of found) {
    const path = `packages/renderers/${renderer.directory}/scenarios.json`
    renderer.scenarios = (await exists(path)) ? (JSON.parse(await readFile(join(root, path), 'utf8')).scenarios ?? []) : []
    renderer.scenariosPath = path
  }
  // In the order hosts show them.
  const order = ['diff', 'side-by-side', 'animated', 'swipe']
  const modes = manifest =>
    (manifest.comparisonModes ?? ['animated', 'side-by-side', 'swipe'])
      .toSorted((a, b) => order.indexOf(a) - order.indexOf(b))
      .map(code)
      .join(', ')
  const page = `${header(['packages/renderers/*/package.json', 'their built renderer.json', 'their scenarios.json'])}# Built-in renderers

A projection's \`renderer\` names a renderer by one of its handles. Each built-in renderer is a sandboxed web page
built with the [renderer SDK](${to('packages/renderers/sdk/README.md')}) and [kit](${to('packages/renderers/kit/README.md')}), exactly as a
custom renderer is. Comparison modes are the ways it presents a comparison, in the order hosts offer them.

${table(
  ['Renderer', 'Handles', 'Comparison modes'],
  found.map(({directory, manifest}) => [`[${manifest.title}](#${manifest.name})`, manifest.handles.map(code).join(', '), modes(manifest)]),
)}

${found
  .map(({directory, pkg, manifest, scenarios, scenariosPath}) => {
    return `## ${code(manifest.name)}

${sentence(pkg.description)} See [its page](${to(`docs/builtins/renderers/${manifest.name}.md`)}).

- Handles: ${manifest.handles.map(code).join(', ')}
- Comparison modes: ${modes(manifest)}
- Package: ${code(pkg.name)}${
      scenarios.length
        ? `\n- Example scenarios ([${code('scenarios.json')}](${to(scenariosPath)})): ${scenarios.map(scenario => scenario.title).join('; ')}`
        : ''
    }`
  })
  .join('\n\n')}
`
  return {[`${outDir}/renderers.md`]: page}
}
