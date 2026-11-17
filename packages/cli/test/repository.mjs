import {execFileSync} from 'node:child_process'
import {cp, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {after} from 'node:test'
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

// Removed once the file's tests are done rather than after each test: a test's own after hooks, which stop the
// processes it started, run after the fixture's, and Windows refuses to remove a running process's directory.
const roots = []
after(() => Promise.all(roots.map(root => rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 200}))))

/** A temporary Git repository holding the polyglot example, removed after the file's tests: `{root, before}`. */
export async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'projections-cli-'))
  roots.push(root)
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
