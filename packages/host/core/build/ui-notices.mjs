import {existsSync, readdirSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const hostManifest = fileURLToPath(new URL('../package.json', import.meta.url))
const shadcnLicense = new URL('../src/ui/components/LICENSE.shadcn.txt', import.meta.url)
const skipped = new Set(['react', 'react-dom', 'scheduler'])

/** The package directory of `name` as resolved from the package at `from`. */
function packageDirectory(name, from) {
  for (let directory = dirname(from); ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) return candidate
    if (directory === dirname(directory)) return createRequire(from).resolve(`${name}/package.json`)
  }
}

/**
 * Every runtime dependency reachable from the package whose manifest is at `manifestPath`, except React and this
 * repository's own packages, as `[name, manifest path]` in name order: what a browser app bundling the package
 * ships. An optional dependency that isn't installed is left out.
 */
export async function runtimeDependencies(manifestPath) {
  const seen = new Map()
  const visit = async path => {
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}))
    for (const name of Object.keys({...manifest.dependencies, ...manifest.optionalDependencies})) {
      if (skipped.has(name) || name.startsWith('@githubnext/') || seen.has(name)) continue
      let found
      try {
        found = packageDirectory(name, path)
      } catch (error) {
        if (optional.has(name)) continue
        throw error
      }
      seen.set(name, found)
      await visit(found)
    }
  }
  await visit(manifestPath)
  return [...seen].sort(([a], [b]) => (a < b ? -1 : 1))
}

/**
 * License notices for the third-party packages the default UI (`./ui`, `./ui/components`) bundles into a
 * browser app: shadcn/ui (copied sources) and every runtime dependency of the host package except React and
 * this repository's own packages. Append the result to an app's THIRD_PARTY_NOTICES.txt.
 */
export async function hostUiNotices() {
  const notices = [`\n===== shadcn/ui (components copied into @githubnext/projections-host) =====\n`, await readFile(shadcnLicense, 'utf8')]
  for (const [name, path] of await runtimeDependencies(hostManifest)) {
    const manifest = JSON.parse(await readFile(path, 'utf8'))
    const license = readdirSync(dirname(path)).find(file => /^licen[cs]e(?:\.(?:md|txt))?$/iu.test(file))
    const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name
    const text = license
      ? await readFile(join(dirname(path), license), 'utf8')
      : `${manifest.license} License${author ? `, Copyright (c) ${author}` : ''}. The package ships no license file; see https://spdx.org/licenses/${manifest.license}.html.\n`
    notices.push(`\n===== ${name} ${manifest.version} (${manifest.license}) =====\n`, text)
  }
  return notices.join('')
}
