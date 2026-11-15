// The fixtures workbench over every built-in renderer package: each
// `packages/renderers/<package>/scenarios.json` and each built bundle (any workspace
// package with "projections": {"renderer": ...}), so rebuilding a renderer
// reloads it in place.
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const renderers = fileURLToPath(new URL('../../', import.meta.url))
/** The native CLI of this workspace. */
export const cli = resolve(renderers, '../cli/dist/projections')

export function inspectorArguments() {
  const fixtures = [],
    bundles = [],
    unbuilt = []
  for (const entry of readdirSync(renderers, {withFileTypes: true})
    .filter(item => item.isDirectory())
    .sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const directory = join(renderers, entry.name)
    if (existsSync(join(directory, 'scenarios.json'))) fixtures.push(join(directory, 'scenarios.json'))
    if (!existsSync(join(directory, 'package.json'))) continue
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    const bundle = manifest.projections?.renderer
    if (typeof bundle !== 'string') continue
    if (existsSync(join(directory, bundle, 'renderer.json'))) bundles.push(join(directory, bundle))
    else unbuilt.push(manifest.name)
  }
  return {fixtures, bundles, unbuilt}
}
