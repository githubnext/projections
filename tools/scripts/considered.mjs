// Runs Considered (https://github.com/quitepicky/considered), which holds every hand-written file to the standards in
// .considered.yaml: size, line length, code lines and complexity, with each documented exception a variance.
//
// It uses the pinned release: the copy `install` downloaded (from GitHub, checksum verified, into the user cache), or
// a `considered` on PATH at the pinned version. CONSIDERED names a binary to use instead.
//
//   node tools/scripts/considered.mjs [check] [--json|--sarif]   check the repository (npm run check:considered)
//   node tools/scripts/considered.mjs install                    download the pinned release for this platform
//   node tools/scripts/considered.mjs --where                    print the binary it would run, or fail
//   node tools/scripts/considered.mjs --version                  print the pinned version
//   node tools/scripts/considered.mjs <args…>                    any other considered command, such as `variance add`
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {delimiter, dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

const root = fileURLToPath(new URL('../../', import.meta.url))
const version = 'v0.1.6'
const repository = 'quitepicky/considered'
// From the release's checksums.txt.
const archives = {
  'darwin-x64': ['darwin_amd64.tar.gz', '60f5330be5844f522fdf826aac45bd13cda7089461a172797306a60677151dfe'],
  'darwin-arm64': ['darwin_arm64.tar.gz', '862cb7dd6421d2552b340dd5e1886b41e84aa88c757c0823b4c7f4171c7f7de3'],
  'linux-x64': ['linux_amd64.tar.gz', 'd591883f64af78c88c5f20cc6bf161ce0df9ed057f93292ba092b55e9464330d'],
  'linux-arm64': ['linux_arm64.tar.gz', '737cadb511268d980a6e4a7feb4eeab830ad0adf4b56828f0a8867e5125e1803'],
  'win32-x64': ['windows_amd64.zip', '1a39dc74626db5b354c3ec2017c9f11b31e440e92cc132608e61bdb1d7df3da5'],
  'win32-arm64': ['windows_arm64.zip', 'cd29ac2f8d73ffa99c07f636d52a5d3923e731743848ea4acaa2eb2b66ec7143'],
}
const exe = process.platform === 'win32' ? '.exe' : ''

function cacheDirectory() {
  const base =
    process.platform === 'win32'
      ? (process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'))
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches')
        : (process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'))
  return join(base, 'projections', 'considered', version)
}

const versionOf = binary => spawnSync(binary, ['version'], {encoding: 'utf8'}).stdout?.trim()

/** The binary to run, or undefined with the reason. */
function resolve() {
  const named = process.env['CONSIDERED']
  if (named) return existsSync(named) ? {binary: named} : {reason: `CONSIDERED names ${named}, which doesn't exist`}
  const cached = join(cacheDirectory(), `considered${exe}`)
  if (existsSync(cached)) return {binary: cached}
  const onPath = versionOf(`considered${exe}`)
  if (onPath === version) return {binary: `considered${exe}`}
  return {reason: onPath ? `considered on PATH is ${onPath}, not the pinned ${version}` : `considered ${version} is not installed`}
}

function run(args) {
  const found = resolve()
  if (!found.binary) {
    console.error(`${found.reason}. Run \`node tools/scripts/considered.mjs install\` (it downloads the pinned release from GitHub and`)
    console.error(`verifies its checksum), or install ${version} from https://github.com/${repository}/releases.`)
    process.exit(2)
  }
  // considered runs its companion considered-scc from PATH; it ships beside the binary.
  const directory = dirname(found.binary)
  const env = directory === '.' ? process.env : {...process.env, PATH: `${directory}${delimiter}${process.env['PATH'] ?? ''}`}
  const result = spawnSync(found.binary, args, {cwd: root, stdio: 'inherit', env})
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

async function install() {
  const archive = archives[`${process.platform}-${process.arch}`]
  if (!archive) throw new Error(`No considered ${version} release for ${process.platform}-${process.arch}`)
  const [suffix, sha256] = archive
  const name = `considered_${version}_${suffix}`
  const target = cacheDirectory()
  if (existsSync(join(target, `considered${exe}`))) return console.log(`considered ${version} is already installed in ${target}`)
  const response = await fetch(`https://github.com/${repository}/releases/download/${version}/${name}`)
  if (!response.ok) throw new Error(`Downloading ${name} failed: ${response.status} ${response.statusText}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== sha256) throw new Error(`${name} has checksum ${actual}, not the pinned ${sha256}`)
  mkdirSync(dirname(target), {recursive: true})
  const scratch = mkdtempSync(join(dirname(target), 'download-'))
  try {
    writeFileSync(join(scratch, name), bytes)
    // tar extracts both archive kinds (bsdtar on macOS and Windows).
    const extracted = spawnSync('tar', ['-xf', name], {cwd: scratch, stdio: 'inherit'})
    if (extracted.status !== 0) throw new Error(`Extracting ${name} failed`)
    const unpacked = join(scratch, name.replace(/\.(tar\.gz|zip)$/u, ''))
    if (!existsSync(join(unpacked, `considered${exe}`))) throw new Error(`${name} has no considered${exe}`)
    renameSync(unpacked, target)
  } finally {
    rmSync(scratch, {recursive: true, force: true})
  }
  console.log(`Installed considered ${version} in ${target}`)
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'install') await install()
else if (command === '--version') console.log(version)
else if (command === '--where') {
  const found = resolve()
  if (!found.binary) {
    console.error(found.reason)
    process.exit(1)
  }
  console.log(found.binary)
} else if (command === undefined || command.startsWith('-')) run(['check', ...process.argv.slice(2)])
else run([command, ...rest])
