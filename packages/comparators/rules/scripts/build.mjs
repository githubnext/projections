// Builds the rules comparator module (core WebAssembly, zero
// imports) into packages/comparators/rules/dist/rules.wasm, with the licenses of every
// crate compiled into it in dist/THIRD_PARTY_NOTICES.txt.
//
// Every rules comparator's digest covers the interpreter's identity. That is
// not the module's bytes: builds of one source on different hosts differ
// (Cargo hashes the host into each crate's metadata, which changes symbol
// order and code layout, not behaviour), and a refactor changes them too. It
// is the digest of the rules language's manifest, which this script embeds in
// the module's `projections.interpreter` custom section.
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
export const artifact = fileURLToPath(new URL('../dist/rules.wasm', import.meta.url))
// Hosts bound comparator memory to 256 MiB by default; the module declares the same maximum.
const maximumMemory = 256 * 1024 * 1024
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo')

const cargoArgs = [
  'rustc',
  '--locked',
  '--release',
  '-p',
  'projections-comparator-rules',
  '--target',
  'wasm32-unknown-unknown',
  '--lib',
  '--crate-type',
  'cdylib',
  '--',
  '-C',
  `link-arg=--max-memory=${maximumMemory}`,
]

/**
 * The interpreter's identity: `sha256:` over a tag and the rules language's manifest (`language.json`, held to the
 * code by tests/language.rs), so it changes when the language does, not when the interpreter is refactored or built
 * on another host.
 */
function languageDigest() {
  const manifest = readFileSync(new URL('../language.json', import.meta.url), 'utf8').replaceAll('\r\n', '\n')
  return `sha256:${createHash('sha256').update(`projections-rules-interpreter\n${manifest}`).digest('hex')}`
}

/** A WebAssembly custom section: id 0, its size, then its name and payload. */
function customSection(name, payload) {
  const leb = value => {
    const out = []
    do {
      let byte = value & 0x7f
      value >>>= 7
      if (value) byte |= 0x80
      out.push(byte)
    } while (value)
    return out
  }
  const nameBytes = Buffer.from(name)
  const body = Buffer.concat([Buffer.from(leb(nameBytes.length)), nameBytes, Buffer.from(payload)])
  return Buffer.concat([Buffer.from([0, ...leb(body.length)]), body])
}

const result = spawnSync('cargo', cargoArgs, {
  cwd: root,
  stdio: 'inherit',
  // Panic locations name source files; their machine-specific prefixes are remapped.
  env: {
    ...process.env,
    CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: [
      `--remap-path-prefix=${cargoHome}=/cargo`,
      `--remap-path-prefix=${root.replace(/[\\/]$/, '')}=/projections`,
    ].join(' '),
  },
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
const identity = languageDigest()
const bytes = Buffer.concat([
  readFileSync(`${root}/target/wasm32-unknown-unknown/release/projections_comparator_rules.wasm`),
  customSection('projections.interpreter', identity),
])
const module = new WebAssembly.Module(bytes)
const imports = WebAssembly.Module.imports(module)
if (imports.length) throw new Error(`Comparator modules must have zero imports: ${JSON.stringify(imports)}`)
const exports = new Map(WebAssembly.Module.exports(module).map(entry => [entry.name, entry.kind]))
for (const [name, kind] of [
  ['memory', 'memory'],
  ['projections_alloc', 'function'],
  ['projections_compare', 'function'],
  ['projections_rules_inspect', 'function'],
]) {
  if (exports.get(name) !== kind) throw new Error(`Comparator module must export ${kind} ${name}`)
}
// Editors' language service is rules-editor.wasm (packages/comparators/rules/editor), never this module viewers download.
if (exports.has('projections_rules_editor')) throw new Error('rules.wasm must not carry the editor language service')
// The module ships to every host, so it must not name the machine that built it.
const text = new TextDecoder('latin1').decode(bytes)
for (const prefix of [cargoHome, root.replace(/[\\/]$/, ''), homedir()]) {
  if (prefix && text.includes(prefix)) throw new Error(`rules.wasm names the machine-specific path ${prefix}; remap it`)
}
mkdirSync(new URL('../dist/', import.meta.url), {recursive: true})
writeFileSync(artifact, bytes)
console.log(`rules.wasm: ${bytes.length} bytes, interpreter ${identity}`)

// The notices cover every third-party crate the wasm32 build compiles in.
const {crateNotices, noticeBuilds} = await import('../../../../tools/scripts/crate-notices.mjs')
writeFileSync(
  new URL('../dist/THIRD_PARTY_NOTICES.txt', import.meta.url),
  crateNotices({
    ...noticeBuilds().rules,
    title: 'Third-party licenses for the Projections rules interpreter (rules.wasm).',
  }),
)
