import {spawnSync} from 'node:child_process'
import {mkdirSync, copyFileSync, chmodSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit', env})
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run('cargo', ['build', '--locked', '--release', '-p', 'projections-engine', '--bin', 'projections-engine'])
run('cargo', ['build', '--locked', '--release', '-p', 'projections-engine', '--target', 'wasm32-unknown-unknown', '--lib'], {
  ...process.env,
  CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: '-C link-arg=--max-memory=536870912',
})
run(process.execPath, ['packages/comparators/default/scripts/build.mjs'])
run(process.execPath, ['packages/engine/js/scripts/validators.mjs'])
run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/engine/js/tsconfig.json'])
mkdirSync(`${packageRoot}/artifacts/native`, {recursive: true})
const executable = `projections-engine${process.platform === 'win32' ? '.exe' : ''}`
copyFileSync(`${root}/target/release/${executable}`, `${packageRoot}/artifacts/native/${executable}`)
chmodSync(`${packageRoot}/artifacts/native/${executable}`, 0o755)
writeFileSync(
  `${packageRoot}/artifacts/native/platform.json`,
  `${JSON.stringify({platform: process.platform, arch: process.arch}, null, 2)}\n`,
)
copyFileSync(`${root}/target/wasm32-unknown-unknown/release/projections_engine.wasm`, `${packageRoot}/artifacts/engine.wasm`)
copyFileSync(`${root}/packages/comparators/default/dist/default-comparator.wasm`, `${packageRoot}/artifacts/default-comparator.wasm`)
copyFileSync(`${root}/LICENSE`, `${packageRoot}/artifacts/LICENSE`)
// The notices cover the CLI's dependencies on every release platform, not only this build host.
const {crateNotices, noticeBuilds} = await import('../../../../tools/scripts/crate-notices.mjs')
writeFileSync(
  `${packageRoot}/artifacts/THIRD_PARTY_NOTICES.txt`,
  crateNotices({
    ...noticeBuilds().engine,
    title:
      'Third-party licenses for the bundled native and Wasm engines.\nIncludes the default comparator module, the rules interpreter and the native CLI dependencies of every release platform.',
  }),
)
