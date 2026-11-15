// Builds the comparator rules language service for editors into packages/comparators/rules/editor/dist/rules-editor.wasm (core
// WebAssembly, zero imports: `memory`, `projections_alloc` and `projections_rules_editor`), with the licenses of every
// crate compiled into it in dist/THIRD_PARTY_NOTICES.txt. Only the VS Code extension ships it; the interpreter every
// viewer downloads, rules.wasm (../scripts/build.mjs), doesn't carry it.
import {spawnSync} from 'node:child_process'
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../../../../', import.meta.url))
export const artifact = fileURLToPath(new URL('../dist/rules-editor.wasm', import.meta.url))
const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo')

const result = spawnSync(
  'cargo',
  [
    'rustc',
    '--locked',
    '--release',
    '-p',
    'projections-rules-editor',
    '--target',
    'wasm32-unknown-unknown',
    '--lib',
    '--crate-type',
    'cdylib',
    '--',
    '-C',
    `link-arg=--max-memory=${256 * 1024 * 1024}`,
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: [
        `--remap-path-prefix=${cargoHome}=/cargo`,
        `--remap-path-prefix=${root.replace(/[\\/]$/, '')}=/projections`,
      ].join(' '),
    },
  },
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
const bytes = readFileSync(`${root}/target/wasm32-unknown-unknown/release/projections_rules_editor.wasm`)
const module = new WebAssembly.Module(bytes)
if (WebAssembly.Module.imports(module).length) throw new Error('rules-editor.wasm must have zero imports')
const exports = new Map(WebAssembly.Module.exports(module).map(entry => [entry.name, entry.kind]))
for (const [name, kind] of [
  ['memory', 'memory'],
  ['projections_alloc', 'function'],
  ['projections_rules_editor', 'function'],
]) {
  if (exports.get(name) !== kind) throw new Error(`rules-editor.wasm must export ${kind} ${name}`)
}
const text = new TextDecoder('latin1').decode(bytes)
for (const prefix of [cargoHome, root.replace(/[\\/]$/, ''), homedir()]) {
  if (prefix && text.includes(prefix)) throw new Error(`rules-editor.wasm names the machine-specific path ${prefix}; remap it`)
}
mkdirSync(new URL('../dist/', import.meta.url), {recursive: true})
writeFileSync(artifact, bytes)
console.log(`rules-editor.wasm: ${bytes.length} bytes`)

const {crateNotices, noticeBuilds} = await import('../../../../../tools/scripts/crate-notices.mjs')
writeFileSync(
  new URL('../dist/THIRD_PARTY_NOTICES.txt', import.meta.url),
  crateNotices({
    ...noticeBuilds()['rules-editor'],
    title: 'Third-party licenses for the Projections comparator rules language service (rules-editor.wasm).',
  }),
)
