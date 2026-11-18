#!/usr/bin/env node
// Writes the extractor's fixtures (tests/fixtures):
//
// - `public/`: real agentic workflows, verbatim from github/gh-aw and githubnext/agentics (both MIT) at pinned
//   commits, with their imports and compiled lock files.
// - `repo-ask/`, `docs-bot/`: synthetic before and after revisions whose lock files the gh-aw release the extractor pins
//   compiles (`docs-bot/after`'s issue-triage keeps its before lock, so it is stale).
//
// Every lock file is trimmed to its first three lines (the `gh-aw-metadata` and `gh-aw-manifest` headers and the
// banner naming the compiler): that header is all the extractor reads, and a whole lock file is about 175 KB.
//
//   node scripts/fixtures.mjs --gh-aw <gh-aw binary at the pinned release>
//       [--gh-aw-source <github/gh-aw checkout>] [--agentics-source <githubnext/agentics checkout>]
//
// Without the source options it fetches the pinned commits from GitHub. Build the binary from the pinned tag:
// `go build -ldflags "-X main.version=v1.3.0 -X main.isRelease=true" -o /tmp/gh-aw ./cmd/gh-aw`.
import {execFileSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const fixtures = fileURLToPath(new URL('../tests/fixtures/', import.meta.url))
const vendor = JSON.parse(readFileSync(new URL('../vendor/gh-aw/vendor.json', import.meta.url), 'utf8'))

const sources = {
  'gh-aw': {repository: 'github/gh-aw', commit: vendor.commit, option: '--gh-aw-source'},
  agentics: {repository: 'githubnext/agentics', commit: '139fa09ef17cde4135e696ff8e7af09bc5ddfa6e', option: '--agentics-source'},
}

/** `public/`'s files: [source, path in the source, path in the fixture]. */
const publicFiles = [
  ['gh-aw', '.github/workflows/firewall.md'],
  ['gh-aw', '.github/workflows/firewall.lock.yml'],
  ['gh-aw', '.github/workflows/shared/otlp.md'],
  ['gh-aw', '.github/workflows/daily-documentation-diagram.md'],
  ['gh-aw', '.github/workflows/daily-documentation-diagram.lock.yml'],
  ['gh-aw', '.github/workflows/shared/reporting.md'],
  ['gh-aw', '.github/workflows/shared/pr-safe-output-defaults.md'],
  ['agentics', '.github/workflows/link-checker.md'],
  ['agentics', '.github/workflows/link-checker.lock.yml'],
]

/** The compiled cases: each side's directory, and workflows whose lock comes from another side's compile. */
const compiled = [
  {side: 'repo-ask/before'},
  {side: 'repo-ask/after'},
  {side: 'docs-bot/before'},
  {side: 'docs-bot/after', stale: {'issue-triage': 'docs-bot/before'}},
]

const argument = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

/** A lock file's header: its first three lines. */
const header = text => `${text.split('\n').slice(0, 3).join('\n')}\n`

async function read(source, path) {
  const local = argument(sources[source].option)
  if (local) return readFileSync(join(local, path), 'utf8')
  const {repository, commit} = sources[source]
  const response = await fetch(`https://raw.githubusercontent.com/${repository}/${commit}/${path}`)
  if (!response.ok) throw new Error(`Fetching ${repository} ${path}: HTTP ${response.status}`)
  return response.text()
}

async function writePublic() {
  const root = join(fixtures, 'public')
  for (const [source, path] of publicFiles) {
    const text = await read(source, path)
    mkdirSync(dirname(join(root, path)), {recursive: true})
    writeFileSync(join(root, path), path.endsWith('.lock.yml') ? header(text) : text)
  }
}

/** Compiles a side in a scratch Git repository and returns its lock headers by workflow name. */
function compile(binary, side) {
  const scratch = mkdtempSync(join(tmpdir(), 'gh-aw-fixture-'))
  try {
    cpSync(join(fixtures, side), scratch, {recursive: true})
    execFileSync('git', ['init', '-q'], {cwd: scratch})
    execFileSync(binary, ['compile', '--no-check-update'], {cwd: scratch, stdio: ['ignore', 'ignore', 'inherit']})
    const workflows = join(scratch, '.github/workflows')
    return Object.fromEntries(
      readdirSync(workflows)
        .filter(name => name.endsWith('.lock.yml'))
        .map(name => [name.slice(0, -'.lock.yml'.length), header(readFileSync(join(workflows, name), 'utf8'))]),
    )
  } finally {
    rmSync(scratch, {recursive: true, force: true})
  }
}

function writeCompiled(binary) {
  const version = execFileSync(binary, ['version'], {encoding: 'utf8'})
  if (!version.includes(vendor.version)) throw new Error(`${binary} is ${version.trim()}, not gh-aw ${vendor.version}`)
  const locks = {}
  for (const {side, stale = {}} of compiled) {
    locks[side] = compile(binary, side)
    for (const [name, from] of Object.entries(stale)) locks[side][name] = locks[from][name]
    const workflows = join(fixtures, side, '.github/workflows')
    for (const name of readdirSync(workflows).filter(name => name.endsWith('.lock.yml'))) rmSync(join(workflows, name))
    for (const [name, text] of Object.entries(locks[side])) writeFileSync(join(workflows, `${name}.lock.yml`), text)
  }
}

const binary = argument('--gh-aw')
if (!binary) throw new Error('Pass --gh-aw <gh-aw binary>, built from the pinned release')
await writePublic()
writeCompiled(binary)
console.log(`Wrote tests/fixtures from gh-aw ${vendor.version}`)
