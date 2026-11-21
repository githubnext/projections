// Packages the VS Code extension for one release target, with that target's proved `projections` executable inside
// (as `npm run tools -- install` packages it), for the release proof job, which attaches it to the GitHub release. It
// is not published to the Marketplace. Then it proves the package: VS Code's own CLI installs it
// (`code --install-extension`, in a VS Code @vscode/test-electron downloads), and the installed extension is the
// release's version for this target, with an executable that runs and is the release's.
//
//   node packages/integrations/vscode/scripts/release-asset.mjs --target linux-x64 --binary release/gh-projections-linux-amd64 --out release
//
// Run `npm run build` in packages/integrations/vscode/ first. Writes OUT/projections-vscode-VERSION-TARGET.vsix, its .sha256 and
// OUT/asset-name (the file name, for the workflow).
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {stage, targets} from './package.mjs'

/** The vsce `npm run tools -- install` packages with (tools/cli/src/commands/install.ts). */
export const vsce = '@vscode/vsce@4.1.0'
export const extensionId = 'githubnext.projections-vscode'

/** The release asset's name for the extension `version` built for the vsce target `target`. */
export const assetName = (version, target) => `projections-vscode-${version}-${target}.vsix`

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options})
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {values} = parseArgs({options: {target: {type: 'string'}, binary: {type: 'string'}, out: {type: 'string'}}})
  const {target, binary, out} = values
  if (!target || !binary || !out) throw new Error('Usage: release-asset.mjs --target TARGET --binary FILE --out DIR')
  const root = fileURLToPath(new URL('../', import.meta.url))
  const {version} = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const destination = path.resolve(out)
  const asset = assetName(version, target)
  const vsix = path.join(destination, asset)
  mkdirSync(destination, {recursive: true})
  const scratch = mkdtempSync(path.join(tmpdir(), 'projections-vscode-release-'))
  try {
    // stage() checks the executable is this extension's version: the release's CLI.
    const directory = await stage({root, target, binary: path.resolve(binary), out: path.join(scratch, 'stage')})
    // The staged directory has its own package.json, so npm wouldn't read the workspace's .npmrc there.
    const registry = /^registry\s*=\s*(\S+)/m.exec(readFileSync(path.join(root, '../../../.npmrc'), 'utf8'))?.[1]
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    run(npx, ['--yes', vsce, 'package', '--target', target, '--no-dependencies', '--out', vsix], {
      cwd: directory,
      env: {...process.env, ...(registry && !process.env.npm_config_registry ? {npm_config_registry: registry} : {})},
      shell: process.platform === 'win32',
    })
    const digest = createHash('sha256').update(readFileSync(vsix)).digest('hex')
    writeFileSync(`${vsix}.sha256`, `${digest}  ${asset}\n`)
    writeFileSync(path.join(destination, 'asset-name'), asset)
    console.log(`${asset} (sha256 ${digest})`)

    // Install it with VS Code's own CLI, into an empty profile.
    const {downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath} = await import('@vscode/test-electron')
    const executable = await downloadAndUnzipVSCode({cachePath: path.join(scratch, 'vscode')})
    const [cli] = resolveCliArgsFromVSCodeExecutablePath(executable, {reuseMachineInstall: true})
    const extensions = path.join(scratch, 'extensions')
    const profile = [`--extensions-dir=${extensions}`, `--user-data-dir=${path.join(scratch, 'user-data')}`]
    run(cli, [...profile, '--install-extension', vsix], {shell: process.platform === 'win32'})
    const listed = run(cli, [...profile, '--list-extensions', '--show-versions'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).stdout
    if (!listed.split(/\r?\n/).includes(`${extensionId}@${version}`)) {
      throw new Error(`VS Code lists ${JSON.stringify(listed.trim())}, not ${extensionId}@${version}`)
    }
    const [installed] = readdirSync(extensions).filter(name => name.startsWith(`${extensionId}-${version}`))
    if (!installed) throw new Error(`${extensions} has no ${extensionId}-${version}`)
    const manifest = JSON.parse(readFileSync(path.join(extensions, installed, 'package.json'), 'utf8'))
    if (manifest.version !== version) throw new Error(`The installed extension is ${manifest.version}, not ${version}`)
    const name = target.startsWith('win32') ? 'projections.exe' : 'projections'
    const bundled = path.join(extensions, installed, 'bin', targets[target], name)
    if (!existsSync(bundled)) throw new Error(`The installed extension has no ${path.relative(extensions, bundled)}`)
    const reported = run(bundled, ['--version'], {stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8'}).stdout.trim()
    if (reported !== `projections ${version}`) throw new Error(`The bundled CLI is ${reported}, not projections ${version}`)
    console.log(`VS Code installed ${extensionId}@${version} (${installed}), whose bundled CLI is ${reported}`)
  } finally {
    rmSync(scratch, {recursive: true, force: true})
  }
}
