// Stages a platform-specific extension package: the built extension (run `npm run build` first) and one platform's
// `projections` executable in bin/<platform>-<arch>/, ready for `vsce package --target <target>`. The executable must
// be the release matching the extension's version (`projections --version`), since the extension pins its CLI.
//
//   node scripts/package.mjs --target darwin-arm64 --binary ../target/release/projections
//   cd .package/darwin-arm64 && npx @vscode/vsce package --target darwin-arm64 --no-dependencies
//
// Without --binary it stages a universal package (no executable), which uses projections.cliPath,
// PROJECTIONS_CLI or PATH. --version ships another version than package.json's, such as a development build's
// `<version>-dev.<commit>` (`npm run tools -- install`); the executable must still be package.json's version.
import {execFileSync} from 'node:child_process'
import {chmod, cp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'

/** vsce's platform targets, and the `<platform>-<arch>` directory (Node's names) each one's executable is in. */
export const targets = {
  'win32-x64': 'win32-x64',
  'win32-arm64': 'win32-arm64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
  'linux-armhf': 'linux-arm',
  'alpine-x64': 'linux-x64',
  'alpine-arm64': 'linux-arm64',
  'darwin-x64': 'darwin-x64',
  'darwin-arm64': 'darwin-arm64',
}

/** The README a package ships: without the front matter (its description, for this repository's tools), which the
 * Marketplace would show as text. */
export function packageReadme(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/u, '')
}

/** The manifest a package ships: no scripts or development dependencies; the dependencies are bundled. */
export function packageManifest(manifest) {
  const {scripts: _scripts, devDependencies: _development, dependencies: _bundled, ...shipped} = manifest
  return shipped
}

/** Stages `target` (or a universal package) in `out`, and returns the directory. */
export async function stage({root, target, binary, out, version}) {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  if (target && !(target in targets)) throw new Error(`Unknown target ${target}; one of ${Object.keys(targets).join(', ')}`)
  if (binary && !target) throw new Error('--binary needs --target')
  await stat(path.join(root, 'dist', 'extension.cjs')).catch(() => {
    throw new Error('Build the extension first: npm run build')
  })
  const directory = path.join(out, target ?? 'universal')
  await rm(directory, {recursive: true, force: true})
  await mkdir(directory, {recursive: true})
  for (const name of ['dist', 'media', 'LICENSE']) await cp(path.join(root, name), path.join(directory, name), {recursive: true})
  await writeFile(path.join(directory, 'README.md'), packageReadme(await readFile(path.join(root, 'README.md'), 'utf8')))
  const shipped = {...packageManifest(manifest), ...(version ? {version} : {})}
  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify(shipped, null, 2)}\n`)
  if (binary) {
    const reported = execFileSync(binary, ['--version'], {encoding: 'utf8'}).trim()
    if (reported !== `projections ${manifest.version}`) {
      throw new Error(`${binary} is ${reported}; this extension (${manifest.version}) ships projections ${manifest.version}`)
    }
    const name = target.startsWith('win32') ? 'projections.exe' : 'projections'
    const destination = path.join(directory, 'bin', targets[target], name)
    await mkdir(path.dirname(destination), {recursive: true})
    await cp(binary, destination)
    await chmod(destination, 0o755)
  }
  return directory
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {values} = parseArgs({
    options: {target: {type: 'string'}, binary: {type: 'string'}, out: {type: 'string'}, version: {type: 'string'}},
  })
  const root = fileURLToPath(new URL('../', import.meta.url))
  const directory = await stage({
    root,
    target: values.target,
    binary: values.binary && path.resolve(values.binary),
    out: path.resolve(values.out ?? path.join(root, '.package')),
    version: values.version,
  })
  console.log(`Staged ${directory}`)
  console.log(
    `Package it with: cd ${path.relative(process.cwd(), directory) || '.'} && npx @vscode/vsce package ${values.target ? `--target ${values.target} ` : ''}--no-dependencies`,
  )
}
