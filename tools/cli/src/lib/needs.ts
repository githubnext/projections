// Whether a generator's or gate's prerequisites are met on this machine.
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import type {Need} from './generated.ts'
import {onPath} from './repo.ts'
import {nightly} from './toolchains.ts'

export const cliBinary = process.platform === 'win32' ? 'packages/cli/dist/projections.exe' : 'packages/cli/dist/projections'

/** Built outputs whose presence means `npm run build` has run. */
const builtMarkers = ['packages/schemas/dist/index.js', 'packages/renderers/sdk/dist/index.js', 'packages/engine/js/dist']

/** The unmet needs among `needs`, each with how to meet it. */
export function unmet(root: string, needs: readonly Need[]): {need: Need; fix: string}[] {
  const missing: {need: Need; fix: string}[] = []
  let night: ReturnType<typeof nightly> | undefined
  for (const need of needs) {
    if (need === 'build' && !builtMarkers.every(path => existsSync(join(root, path)))) missing.push({need, fix: 'npm run build'})
    if (need === 'cli' && !existsSync(join(root, cliBinary))) {
      missing.push({need, fix: 'npm run build (builds packages/cli/dist/projections)'})
    }
    if (need === 'rust' && !onPath('cargo')) missing.push({need, fix: 'install Rustup (rust-toolchain.toml selects the toolchain)'})
    if (need === 'dist' && !onPath('dist')) missing.push({need, fix: 'install the dist version dist-workspace.toml pins (cargo-dist)'})
    if (need === 'nightly') {
      night ??= nightly(root)
      if (!night.installed) {
        missing.push({
          need,
          fix: `rustup toolchain install ${night.name ?? '<node tools/scripts/reference-docs.mjs --nightly>'} --profile minimal`,
        })
      }
    }
    if (need === 'network') missing.push({need, fix: 'run it explicitly; it downloads from the network'})
    if (need === 'browser') missing.push({need, fix: 'run it explicitly; it drives a browser'})
    if (need === 'toolchains') missing.push({need, fix: "run it explicitly with each ecosystem's toolchain installed"})
  }
  return missing
}
