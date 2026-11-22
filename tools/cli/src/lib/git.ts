// Git state: the branch, dirty files, and the files changed since a base.
import {git} from './repo.ts'

export interface GitState {
  branch: string | undefined
  head: string | undefined
  dirty: number
  untracked: number
}

export function gitState(root: string): GitState {
  const status = git(root, ['status', '--porcelain=v1', '--', '.']) ?? ''
  const lines = status ? status.split('\n') : []
  return {
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    head: git(root, ['rev-parse', '--short', 'HEAD']),
    dirty: lines.filter(line => !line.startsWith('??')).length,
    untracked: lines.filter(line => line.startsWith('??')).length,
  }
}

export interface Base {
  ref: string
  commit: string
  reason: string
}

/** The repository's default branch: origin/HEAD, else origin/main, main or master. */
export function defaultBranch(root: string): string | undefined {
  const head = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (head) return head
  return ['origin/main', 'main', 'origin/master', 'master'].find(ref => git(root, ['rev-parse', '--verify', '--quiet', ref]))
}

/**
 * The commit to compare against. `--since REF` is that ref. Otherwise the merge base with the branch this one was
 * started from (its upstream, when that is another branch), else with the default branch.
 */
export function resolveBase(root: string, since?: string): Base | undefined {
  if (since) {
    const commit = git(root, ['rev-parse', '--verify', '--quiet', `${since}^{commit}`])
    return commit ? {ref: since, commit, reason: '--since'} : undefined
  }
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  const candidates: [string, string][] = []
  if (upstream && upstream.replace(/^[^/]+\//u, '') !== branch) candidates.push([upstream, 'merge base with the upstream branch'])
  const fallback = defaultBranch(root)
  if (fallback) candidates.push([fallback, 'merge base with the default branch'])
  for (const [ref, reason] of candidates) {
    const commit = git(root, ['merge-base', 'HEAD', ref])
    if (commit) return {ref, commit, reason}
  }
  return undefined
}

export interface Change {
  path: string
  status: string
}

/** Status letters to words. */
const statuses: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type changed',
  '?': 'untracked',
}

/** Files under the workspace root changed since `base` (committed, staged, unstaged and untracked), relative to it. */
export function changedFiles(root: string, base: Base | undefined): Change[] {
  const changes = new Map<string, string>()
  const diff = git(root, ['diff', '--relative', '--name-status', '--no-renames', base?.commit ?? 'HEAD', '--', '.']) ?? ''
  for (const line of diff.split('\n')) {
    const [status, path] = line.split('\t')
    if (status && path) changes.set(path, statuses[status[0]!] ?? status)
  }
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '--', '.']) ?? ''
  for (const path of untracked.split('\n')) if (path) changes.set(path, 'untracked')
  return [...changes].map(([path, status]) => ({path, status})).toSorted((a, b) => a.path.localeCompare(b.path))
}
