// Builds the default comparator as a comparator module (core WebAssembly, zero
// imports) into packages/comparators/default/dist/default-comparator.wasm.
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
export const artifact = fileURLToPath(new URL('../dist/default-comparator.wasm', import.meta.url))
// Hosts bound comparator memory to 256 MiB by default; the module declares the same maximum.
const maximumMemory = 256 * 1024 * 1024

const result = spawnSync(
  'cargo',
  [
    'rustc',
    '--locked',
    '--release',
    '-p',
    'projections-comparator-default',
    '--target',
    'wasm32-unknown-unknown',
    '--lib',
    '--crate-type',
    'cdylib',
    '--',
    '-C',
    `link-arg=--max-memory=${maximumMemory}`,
  ],
  {cwd: root, stdio: 'inherit'},
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
const bytes = readFileSync(`${root}/target/wasm32-unknown-unknown/release/projections_comparator_default.wasm`)
const module = new WebAssembly.Module(bytes)
const imports = WebAssembly.Module.imports(module)
if (imports.length) throw new Error(`Comparator modules must have zero imports: ${JSON.stringify(imports)}`)
const exports = new Map(WebAssembly.Module.exports(module).map(entry => [entry.name, entry.kind]))
for (const [name, kind] of [
  ['memory', 'memory'],
  ['projections_alloc', 'function'],
  ['projections_compare', 'function'],
]) {
  if (exports.get(name) !== kind) throw new Error(`Comparator module must export ${kind} ${name}`)
}
mkdirSync(new URL('../dist/', import.meta.url), {recursive: true})
// Written only when it changed: the CLI's build embeds the module and rebuilds whenever it is rewritten.
if (!existsSync(artifact) || !readFileSync(artifact).equals(bytes)) writeFileSync(artifact, bytes)
