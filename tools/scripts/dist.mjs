// Generates or checks the dist release workflow (.github/workflows/release.yml) from
// dist-workspace.toml, with the exact dist version that file pins.
//
//   node tools/scripts/dist.mjs           regenerate .github/workflows/release.yml
//   node tools/scripts/dist.mjs --check   fail if it differs from what dist generates
//
// dist writes to the enclosing Git repository's .github. When this workspace is not
// a repository root (it is nested in another repository), the workspace is
// copied to a temporary repository and dist runs there instead.
import {spawnSync} from 'node:child_process'
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const check = process.argv.includes('--check')
const dist = process.env.DIST ?? 'dist'
const pinned = /^cargo-dist-version\s*=\s*"([^"]+)"/m.exec(await readFile(path.join(root, 'dist-workspace.toml'), 'utf8'))?.[1]
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8'})
  if (result.error) throw new Error(`${command} could not run (${result.error.message}); install dist ${pinned} or set DIST`)
  return result
}
const version = run(dist, ['--version'], root).stdout.trim()
if (version !== `cargo-dist ${pinned}`) throw new Error(`dist-workspace.toml pins dist ${pinned}, but ${dist} is ${version}`)
const toplevel = run('git', ['rev-parse', '--show-toplevel'], root).stdout.trim()
const ignored = new Set(['node_modules', 'target', 'dist', '.git', 'test-results', 'playwright-report', '.venv', '__pycache__'])
let cwd = root
let temporary
if (path.resolve(toplevel) !== path.resolve(root)) {
  temporary = await mkdtemp(path.join(tmpdir(), 'projections-dist-'))
  cwd = path.join(temporary, 'workspace')
  await cp(root, cwd, {
    recursive: true,
    filter: file =>
      !path
        .relative(root, file)
        .split(path.sep)
        .some(part => ignored.has(part)),
  })
  for (const args of [
    ['init', '--quiet'],
    ['add', '--all'],
    ['-c', 'user.name=dist', '-c', 'user.email=dist@example.invalid', 'commit', '--quiet', '-m', 'workspace'],
  ]) {
    const result = run('git', args, cwd)
    if (result.status !== 0) throw new Error(result.stderr)
  }
}
try {
  const result = run(dist, ['generate', '--mode', 'ci', ...(check ? ['--check'] : [])], cwd)
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  if (result.status !== 0) process.exit(result.status ?? 1)
  if (temporary && !check) {
    const workflow = '.github/workflows/release.yml'
    await writeFile(path.join(root, workflow), await readFile(path.join(cwd, workflow)))
  }
} finally {
  if (temporary) await rm(temporary, {recursive: true, force: true})
}
