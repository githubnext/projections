import {execFile} from 'node:child_process'
import {copyFile, mkdtemp, readdir, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {promisify} from 'node:util'
import {historyOrder} from './ancestry.js'
import {isBackwards, sideLabel} from './labels.js'
import type {RefFacts, RefNames, SideLabel} from './labels.js'
import type {Pair} from './projections/pairs.js'
import type {ProjectionDefinition} from './projections/definitions.js'
import {declaredFiles, editKey, editState, parseStatus, touchedEntries} from './edits.js'
import type {EditState} from './edits.js'

const run = promisify(execFile)

/** A pair's sides as people read them, and whether it runs backwards. */
export interface PairLabels {
  before?: SideLabel
  after: SideLabel
  backwards: boolean
}

/** What git says about a ref: its commit, subject and date, or the working tree's uncommitted files. */
async function facts(cwd: string, ref: string): Promise<RefFacts> {
  if (ref === 'working-tree') {
    try {
      const {stdout} = await run('git', ['status', '--porcelain', '--untracked-files=all'], {cwd})
      const lines = stdout.split('\n').filter(Boolean)
      const untracked = lines.filter(line => line.startsWith('??')).length
      return {ref, changes: {changed: lines.length - untracked, untracked}}
    } catch {
      return {ref}
    }
  }
  try {
    const {stdout} = await run('git', ['log', '-1', '--format=%H%x00%s%x00%cI', '--end-of-options', `${ref}^{commit}`, '--'], {cwd})
    const [commit, subject, date] = stdout.trim().split('\0')
    return {ref, ...(commit ? {commit} : {}), ...(subject ? {subject} : {}), ...(date ? {date} : {})}
  } catch {
    return {ref}
  }
}

/**
 * Whether a pair runs backwards: by history when one side is in the other's (After an ancestor of Before), else, for
 * sides on diverged branches, by commit date. Dates alone mislead when commits were made out of order.
 */
async function runsBackwards(cwd: string, before: RefFacts | undefined, after: RefFacts): Promise<boolean> {
  if (before?.commit && after.commit) {
    const order = await historyOrder(cwd, before.commit, after.commit)
    if (order) return order === 'backwards'
  }
  return isBackwards(before, after)
}

/** Names both sides of a pair in the repository at `cwd`. */
export async function describePair(cwd: string, pair: Pair, names: RefNames): Promise<PairLabels> {
  const [before, after] = await Promise.all([pair.before ? facts(cwd, pair.before) : undefined, facts(cwd, pair.after)])
  return {
    ...(before ? {before: sideLabel(before, names)} : {}),
    after: sideLabel(after, names),
    backwards: await runsBackwards(cwd, before, after),
  }
}

/** How many files are uncommitted (changed and untracked), and how many commits `HEAD` is ahead of `base`. */
export async function workingFacts(cwd: string, base: string | undefined): Promise<{changes?: number; ahead?: number}> {
  const [changes, ahead] = await Promise.all([
    run('git', ['status', '--porcelain', '--untracked-files=all'], {cwd}).then(
      ({stdout}) => stdout.split('\n').filter(Boolean).length,
      () => undefined,
    ),
    base
      ? run('git', ['rev-list', '--count', '--end-of-options', `${base}..HEAD`], {cwd}).then(
          ({stdout}) => Number.parseInt(stdout.trim(), 10),
          () => undefined,
        )
      : Promise.resolve(undefined),
  ])
  return {
    ...(changes !== undefined ? {changes} : {}),
    ...(ahead !== undefined && Number.isFinite(ahead) ? {ahead} : {}),
  }
}

/**
 * The working tree's Git tree: the tree `git add -A` would commit, written with a temporary index seeded from the real
 * one (so only files whose stat changed are hashed), as the backend's local execution does. The index and refs are
 * untouched; changed files' blobs go to the object store, as `git stash` would.
 */
export async function workingTreeTree(cwd: string): Promise<string | undefined> {
  const directory = await mkdtemp(join(tmpdir(), 'projections-index-'))
  try {
    const index = join(directory, 'index')
    const {stdout: real} = await run('git', ['rev-parse', '--path-format=absolute', '--git-path', 'index'], {cwd})
    await copyFile(real.trim(), index).catch(() => {})
    const env = {...process.env, GIT_INDEX_FILE: index}
    await run('git', ['add', '-A', '--', '.'], {cwd, env, maxBuffer: 16 * 1024 * 1024})
    const {stdout} = await run('git', ['write-tree'], {cwd, env})
    return stdout.trim() || undefined
  } catch {
    return undefined
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
}

/** How many files differ between two trees (or commits). */
export async function changedFileCount(cwd: string, from: string, to: string): Promise<number | undefined> {
  return (await changedFiles(cwd, from, to))?.length
}

/** The files that differ between two trees (or commits), repository-relative. */
export async function changedFiles(cwd: string, from: string, to: string): Promise<string[] | undefined> {
  if (from === to) return []
  try {
    const {stdout} = await run('git', ['diff', '--no-renames', '--name-only', '-z', '--end-of-options', from, to, '--'], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    })
    return stdout.split('\0').filter(Boolean)
  } catch {
    return undefined
  }
}

/**
 * How many files differ between a pair's sides: two revisions, or a revision and the working tree (its untracked files
 * included); `undefined` when git can't say.
 */
export async function pairFileCount(cwd: string, before: string, after: string): Promise<number | undefined> {
  if (before === after) return 0
  const revision = before === 'working-tree' ? after : before
  if (before !== 'working-tree' && after !== 'working-tree') return changedFileCount(cwd, before, after)
  try {
    const options = {cwd, maxBuffer: 16 * 1024 * 1024}
    const [tracked, untracked] = await Promise.all([
      run('git', ['diff', '--no-renames', '--name-only', '-z', '--end-of-options', revision, '--'], options),
      run('git', ['ls-files', '--others', '--exclude-standard', '-z'], options),
    ])
    return new Set([...tracked.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean)).size
  } catch {
    return undefined
  }
}

/**
 * The checkout's top level and the path of `cwd` in it, as `git rev-parse --show-prefix` prints it (`a/b/`, or empty
 * at the top level); nothing outside a Git checkout.
 */
export async function checkoutLocation(cwd: string): Promise<{top: string; prefix: string} | undefined> {
  try {
    const {stdout} = await run('git', ['rev-parse', '--show-toplevel', '--show-prefix'], {cwd})
    const [top, prefix = ''] = stdout.split('\n')
    return top ? {top, prefix} : undefined
  } catch {
    return undefined
  }
}

/**
 * Each projection's uncommitted edits (`edits.ts`): its definition file and the files it declares, against `HEAD`;
 * and, for an edited one, its `editKey`, which changes whenever the edits do. `cwd` is the definitions' project, which
 * their paths are relative to; git reports repository-relative paths, so every path is compared as one.
 */
export async function definitionEdits(
  cwd: string,
  definitions: readonly ProjectionDefinition[],
): Promise<{states: Map<string, EditState>; keys: Map<string, string>}> {
  const states = new Map<string, EditState>()
  const keys = new Map<string, string>()
  const location = await checkoutLocation(cwd)
  if (!location) return {states, keys}
  const {top, prefix} = location
  const paths = new Map<string, string>()
  for (const directory of ['.github/projections', '.projections']) {
    const names = await readdir(join(cwd, directory)).catch(() => [] as string[])
    for (const name of names.filter(item => item.endsWith('.json')).sort()) {
      try {
        const id = (JSON.parse(await readFile(join(cwd, directory, name), 'utf8')) as {id?: unknown}).id
        if (typeof id === 'string' && !paths.has(id)) paths.set(id, `${prefix}${directory}/${name}`)
      } catch {
        // Not a definition (or not yet valid JSON): its projection is reported elsewhere.
      }
    }
  }
  const files = new Map(definitions.map(definition => [definition.id, declaredFiles(definition, prefix)]))
  const all = [...new Set([...paths.values(), ...[...files.values()].flat()])]
  if (!all.length) return {states, keys}
  try {
    const options = {cwd: top, maxBuffer: 16 * 1024 * 1024}
    const [status, committed] = await Promise.all([
      run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...all], options),
      run('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--', ...paths.values()], options).then(
        ({stdout}) => new Set(stdout.split('\0').filter(Boolean)),
        () => new Set<string>(),
      ),
    ])
    const entries = parseStatus(status.stdout)
    // What each edited file holds now, so the edits' key changes with every save.
    const present = [...new Set(entries.filter(entry => !entry.code.includes('D')).map(entry => entry.path))]
    const hashes = new Map<string, string>()
    if (present.length) {
      const hashed = await run('git', ['hash-object', '--no-filters', '--', ...present], options).catch(() => undefined)
      const lines = hashed?.stdout.split('\n').filter(Boolean) ?? []
      if (lines.length === present.length) present.forEach((path, index) => hashes.set(path, lines[index]!))
    }
    for (const definition of definitions) {
      const path = paths.get(definition.id)
      if (!path) continue
      const declared = files.get(definition.id) ?? []
      const state = editState(path, declared, entries, committed.has(path))
      states.set(definition.id, state)
      const key = state === 'edited' ? editKey(touchedEntries(path, declared, entries), hashes) : undefined
      if (key) keys.set(definition.id, key)
    }
  } catch {
    // Not a Git repository: nothing is committed or edited.
  }
  return {states, keys}
}

/** The repository's default branch: `origin/HEAD`, else `main` or `master`. */
export async function defaultBranch(cwd: string): Promise<string> {
  try {
    const {stdout} = await run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], {cwd})
    if (stdout.trim()) return stdout.trim()
  } catch {
    /* no origin/HEAD */
  }
  for (const name of ['main', 'master', 'origin/main', 'origin/master']) {
    try {
      await run('git', ['rev-parse', '--verify', '--quiet', `${name}^{commit}`], {cwd})
      return name
    } catch {
      /* try the next */
    }
  }
  throw new Error('This repository has no origin/HEAD, main or master branch to compare with')
}

/** The commits refs name here (`working-tree` and unknown refs name none). */
export async function resolveCommits(cwd: string, refs: string[]): Promise<Array<string | undefined>> {
  return Promise.all(
    refs.map(ref =>
      ref && ref !== 'working-tree'
        ? run('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], {cwd}).then(
            ({stdout}) => stdout.trim() || undefined,
            () => undefined,
          )
        : Promise.resolve(undefined),
    ),
  )
}
