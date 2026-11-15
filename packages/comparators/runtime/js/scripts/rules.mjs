// Builds the rules interpreter and copies it into dist with its notices, and
// builds the native rules runner servers use.
import {spawnSync} from 'node:child_process'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chmod, copyFile, mkdir, writeFile} from 'node:fs/promises'

const rules = spawnSync(process.execPath, [fileURLToPath(new URL('../../../rules/scripts/build.mjs', import.meta.url))], {stdio: 'inherit'})
if (rules.error) throw rules.error
if (rules.status !== 0) process.exit(rules.status ?? 1)
await copyFile(new URL('../../../rules/dist/rules.wasm', import.meta.url), new URL('../dist/rules.wasm', import.meta.url))
await copyFile(
  new URL('../../../rules/dist/THIRD_PARTY_NOTICES.txt', import.meta.url),
  new URL('../dist/LICENSE.rules-interpreter.txt', import.meta.url),
)

// The native rules runner servers use: wasmi with the CLI's bounds.
const root = fileURLToPath(new URL('../../../../../', import.meta.url))
const runner = spawnSync(
  'cargo',
  ['build', '--locked', '--release', '-p', 'projections-comparator-runtime', '--bin', 'projections-rules'],
  {
    cwd: root,
    stdio: 'inherit',
  },
)
if (runner.error) throw runner.error
if (runner.status !== 0) process.exit(runner.status ?? 1)
const executable = `projections-rules${process.platform === 'win32' ? '.exe' : ''}`
await mkdir(new URL('../dist/native/', import.meta.url), {recursive: true})
await copyFile(join(root, 'target', 'release', executable), new URL(`../dist/native/${executable}`, import.meta.url))
await chmod(new URL(`../dist/native/${executable}`, import.meta.url), 0o755)
await writeFile(
  new URL('../dist/native/platform.json', import.meta.url),
  `${JSON.stringify({platform: process.platform, arch: process.arch}, null, 2)}\n`,
)
const {crateNotices, noticeBuilds} = await import(new URL('../../../../../tools/scripts/crate-notices.mjs', import.meta.url).href)
await writeFile(
  new URL('../dist/native/THIRD_PARTY_NOTICES.txt', import.meta.url),
  crateNotices({
    ...noticeBuilds()['rules-runner'],
    title: 'Third-party licenses for the native rules runner (projections-rules).',
  }),
)
