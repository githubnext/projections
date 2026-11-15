import {execFileSync} from 'node:child_process'
import {cp, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const examples = fileURLToPath(new URL('../../../examples/polyglot/', import.meta.url))

/** Runs Git in `root` without hooks. */
export const git = (root, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {cwd: root, encoding: 'utf8'})

/** Commits everything in `root` and returns the commit. */
export const commit = root => {
  git(root, 'add', '--all')
  git(root, 'commit', '-qm', 'fixture')
  return git(root, 'rev-parse', 'HEAD').trim()
}

/** A temporary Git repository holding the polyglot example, removed after the test: `{root, before}`. */
export async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'projections-cli-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  await cp(examples, root, {recursive: true})
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'CLI test')
  git(root, 'config', 'user.email', 'cli@example.invalid')
  git(root, 'config', 'commit.gpgsign', 'false')
  return {root, before: commit(root)}
}

/** A definition using the removed module comparator, beside the polyglot example's valid ones. */
export const legacyDefinition = `{
  "id": "legacy",
  "title": "Legacy",
  "extractor": "repository-map",
  "renderer": "graph",
  "comparator": {
    "module": "dist/order.wasm"
  }
}
`
