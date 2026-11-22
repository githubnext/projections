// Proves packages/engine/verified with the pinned Verus release (verus.toml), then runs
// the mutation check. CI and `tools verify` both run this; it needs only Node
// and, with --install, curl, unzip and rustup.
//
//   node packages/engine/verified/scripts/verify.mjs [--install] [--no-mutants] [--json] [--verus <path>]
//
// --json prints the report as JSON on stdout and progress on stderr.
//
// Verus is found at --verus, $VERUS, or the cache ($VERUS_CACHE, default
// ~/.cache/projections/verus); --install downloads the pinned release there
// and installs the Rust toolchain it needs. Exit codes: 0 proved, 1 a proof
// or mutant failed, 3 a prerequisite is missing.

import {execFileSync, spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {mutationCheck} from './mutants.mjs'

const crate = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The pins in verus.toml: `release`, `toolchain` and `macros`. */
export function pins() {
  const text = readFileSync(join(crate, 'verus.toml'), 'utf8')
  const value = key => {
    const found = new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm').exec(text)?.[1]
    if (!found) throw new Error(`packages/engine/verified/verus.toml has no ${key}`)
    return found
  }
  return {release: value('release'), toolchain: value('toolchain'), macros: value('macros')}
}

/** The release asset's platform, as Verus names it. */
function platform() {
  const os = {darwin: 'macos', linux: 'linux', win32: 'win'}[process.platform]
  const arch = {arm64: 'arm64', x64: 'x86'}[process.arch]
  if (!os || !arch) throw new Prerequisite(`Verus has no release for ${process.platform} ${process.arch}`)
  return `${arch}-${os}`
}

class Prerequisite extends Error {
  constructor(message, hint) {
    super(message)
    this.hint = hint
  }
}

function cacheDirectory(release) {
  const base = process.env.VERUS_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'projections', 'verus')
  return join(base, release)
}

/** Downloads and unpacks the pinned release into the cache. */
function download(release, directory) {
  const asset = `verus-${release}-${platform()}.zip`
  const zip = join(directory, asset)
  mkdirSync(directory, {recursive: true})
  const url = `https://github.com/verus-lang/verus/releases/download/release/${release}/${asset}`
  execFileSync('curl', ['--fail', '--silent', '--show-error', '--location', '--output', zip, url], {stdio: 'inherit'})
  execFileSync('unzip', ['-q', '-o', zip, '-d', directory], {stdio: 'inherit'})
  rmSync(zip)
}

/** The `verus` executable of the pinned release. */
export function locate({install = false, verus} = {}) {
  const explicit = verus ?? process.env.VERUS
  if (explicit) return explicit
  const {release} = pins()
  const directory = cacheDirectory(release)
  const executable = join(directory, `verus-${platform()}`, process.platform === 'win32' ? 'verus.exe' : 'verus')
  if (!existsSync(executable)) {
    if (!install) throw new Prerequisite(`Verus ${release} is not installed`, 'Run with --install, or set VERUS to its verus executable')
    download(release, directory)
  }
  return executable
}

/** Checks the Rust toolchain Verus needs, installing it with --install. */
export function toolchain({install = false} = {}) {
  const {toolchain: channel} = pins()
  const listed = spawnSync('rustup', ['toolchain', 'list'], {encoding: 'utf8'})
  if (listed.status !== 0) throw new Prerequisite('rustup is not installed', 'https://rustup.rs')
  const installed = listed.stdout.split('\n').some(line => line.split(' ')[0].startsWith(`${channel}-`))
  if (installed) return channel
  if (!install) throw new Prerequisite(`Verus needs Rust ${channel}`, `rustup toolchain install ${channel} --profile minimal`)
  execFileSync('rustup', ['toolchain', 'install', channel, '--profile', 'minimal'], {stdio: 'inherit'})
  return channel
}

/** Checks that Cargo.toml uses the macros the pinned release was built with. */
export function consistent() {
  const {macros} = pins()
  const manifest = readFileSync(join(crate, 'Cargo.toml'), 'utf8')
  const used = /^verus_builtin_macros\s*=\s*"=([^"]+)"/mu.exec(manifest)?.[1]
  if (used !== macros) {
    return [`packages/engine/verified/Cargo.toml uses verus_builtin_macros ${used ?? '(none)'}, but verus.toml pins ${macros}`]
  }
  return []
}

/** Runs Verus over the crate: the number of verified items and any errors. */
export function prove(verus) {
  const started = Date.now()
  const run = spawnSync(verus, ['--crate-type=lib', '--rlimit', '30', join(crate, 'src', 'lib.rs')], {encoding: 'utf8'})
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const results = /verification results:: (\d+) verified, (\d+) errors/u.exec(output)
  return {
    ok: run.status === 0 && results?.[2] === '0',
    verified: Number(results?.[1] ?? 0),
    errors: Number(results?.[2] ?? 0),
    seconds: (Date.now() - started) / 1000,
    output: run.status === 0 ? '' : output,
  }
}

/** Proves the crate and runs the mutation check. */
export async function verify({install = false, mutants = true, verus, log = () => {}} = {}) {
  const problems = consistent()
  if (problems.length) return {status: 'fail', problems}
  const executable = locate({install, verus})
  toolchain({install})
  log(`Proving packages/engine/verified with ${executable}`)
  const proof = prove(executable)
  if (!proof.ok) return {status: 'fail', proof, problems: ['Verus did not prove packages/engine/verified']}
  log(`${proof.verified} verified in ${proof.seconds.toFixed(1)}s`)
  const mutation = mutants ? await mutationCheck(executable, log) : undefined
  const missed = mutation?.results.filter(result => !result.caught) ?? []
  return {
    status: missed.length ? 'fail' : 'pass',
    proof,
    mutation,
    problems: missed.map(result => `Mutant not caught on its clause: ${result.name}`),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const verusAt = args.indexOf('--verus')
  try {
    const report = await verify({
      install: args.includes('--install'),
      mutants: !args.includes('--no-mutants'),
      verus: verusAt >= 0 ? args[verusAt + 1] : undefined,
      log: line => (json ? console.error(line) : console.log(line)),
    })
    if (json) console.log(JSON.stringify(report))
    else {
      for (const problem of report.problems ?? []) console.error(problem)
      if (report.proof?.output) console.error(report.proof.output)
    }
    process.exitCode = report.status === 'pass' ? 0 : 1
  } catch (error) {
    if (!(error instanceof Prerequisite)) throw error
    if (json) console.log(JSON.stringify({status: 'prerequisite', problems: [error.message], hint: error.hint}))
    else console.error(`${error.message}${error.hint ? `\n${error.hint}` : ''}`)
    process.exitCode = 3
  }
}
