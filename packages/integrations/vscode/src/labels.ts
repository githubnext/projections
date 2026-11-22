/*
 * Human-readable names for the two sides of a Before → After pair: the branch or tag at the commit, HEAD's branch, the
 * working tree with its uncommitted files, or the merge base with the default branch, then the commit's subject and
 * age. Nothing here imports VS Code, so it is unit tested on its own.
 */
import {plural} from './plural.ts'

/** What git says about one side of the pair. */
export interface RefFacts {
  /** The ref as the pair names it: `working-tree`, `HEAD`, a branch, a tag or a commit. */
  ref: string
  commit?: string
  subject?: string
  /** ISO 8601 commit date. */
  date?: string
  /** The working tree's uncommitted files. */
  changes?: {changed: number; untracked: number}
}

/** The repository's names for commits, from `GET /api/pairs`. */
export interface RefNames {
  head?: {branch?: string; commit?: string}
  branches?: {name: string; commit?: string; current?: boolean}[]
  tags?: {name: string; commit?: string}[]
  mergeBase?: string
  defaultBranch?: string
}

export interface SideLabel {
  ref: string
  kind: 'working-tree' | 'branch' | 'tag' | 'merge-base' | 'commit'
  /** `main`, `v1.0`, `Working tree`, `merge base with main`, or a short commit when nothing names it. */
  name: string
  subject?: string
  age?: string
  date?: string
  commit?: string
  /** For the working tree: `1 changed, 1 untracked`, or `no uncommitted changes`. */
  changes?: string
}

const short = (commit: string) => commit.slice(0, 8)

/** "just now", "5 minutes ago", "yesterday", "2 days ago", "3 weeks ago", "4 months ago", "2 years ago". */
export function relativeAge(date: string | undefined, now: number = Date.now()): string | undefined {
  const time = date ? Date.parse(date) : NaN
  if (!Number.isFinite(time)) return undefined
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${plural(hours, 'hour')} ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  if (days < 365) return `${Math.round(days / 30)} months ago`
  return `${plural(Math.round(days / 365), 'year')} ago`
}

/** Names one side of a pair. */
export function sideLabel(facts: RefFacts, names: RefNames, now: number = Date.now()): SideLabel {
  const base = {
    ref: facts.ref,
    ...(facts.subject ? {subject: facts.subject} : {}),
    ...(facts.date ? {date: facts.date} : {}),
    ...(facts.commit ? {commit: facts.commit} : {}),
  }
  const age = relativeAge(facts.date, now)
  const dated = {...base, ...(age ? {age} : {})}
  if (facts.ref === 'working-tree') {
    const changed = facts.changes?.changed ?? 0
    const untracked = facts.changes?.untracked ?? 0
    const parts = [...(changed ? [`${changed} changed`] : []), ...(untracked ? [`${untracked} untracked`] : [])]
    return {
      ref: facts.ref,
      kind: 'working-tree',
      name: 'Working tree',
      changes: parts.length ? parts.join(', ') : 'no uncommitted changes',
    }
  }
  const branches = names.branches ?? []
  const tags = names.tags ?? []
  const ref = facts.ref.replace(/^refs\/(heads|tags)\//, '')
  if (branches.some(branch => branch.name === ref)) return {...dated, kind: 'branch', name: ref}
  if (tags.some(tag => tag.name === ref)) return {...dated, kind: 'tag', name: ref}
  if (ref === 'HEAD' && names.head?.branch) return {...dated, kind: 'branch', name: names.head.branch}
  const commit = facts.commit ?? (/^[0-9a-f]{40}$/.test(ref) ? ref : undefined)
  if (commit) {
    // The branch at the commit (the current one, then the default, then any), then a tag, then the merge base.
    const at = branches.filter(branch => branch.commit === commit)
    const branch =
      at.find(item => item.current) ??
      at.find(item => item.name === names.defaultBranch) ??
      at.toSorted((a, b) => a.name.localeCompare(b.name))[0]
    if (branch) return {...dated, kind: 'branch', name: branch.name}
    const tag = tags.find(item => item.commit === commit)
    if (tag) return {...dated, kind: 'tag', name: tag.name}
    if (names.mergeBase && names.mergeBase === commit) {
      return {...dated, kind: 'merge-base', name: `merge base with ${names.defaultBranch ?? 'the default branch'}`}
    }
    return {...dated, kind: 'commit', name: short(commit)}
  }
  return {...dated, kind: 'commit', name: ref}
}

/** `main · Add auth package · 2 days ago`, or `Working tree · 1 untracked`; never a bare commit without its subject. */
export function sideText(label: SideLabel, {age = true}: {age?: boolean} = {}): string {
  if (label.kind === 'working-tree') return `${label.name} · ${label.changes}`
  return [label.name, ...(label.subject ? [`"${label.subject}"`] : []), ...(age && label.age ? [label.age] : [])].join(' · ')
}

/** `main ↔ Working tree`, as the diff editor titles a comparison. */
export function pairTitle(before: SideLabel | undefined, after: SideLabel): string {
  return before ? `${before.name} ↔ ${after.name}` : after.name
}

/** Whether After is older than Before, so the comparison runs backwards. The working tree is the newest. */
export function isBackwards(before: SideLabel | RefFacts | undefined, after: SideLabel | RefFacts): boolean {
  if (!before || before.ref === after.ref) return false
  if (after.ref === 'working-tree') return false
  if (before.ref === 'working-tree') return true
  const from = before.date ? Date.parse(before.date) : NaN
  const to = after.date ? Date.parse(after.date) : NaN
  return Number.isFinite(from) && Number.isFinite(to) && to < from
}

/** The codicon for a side's kind of ref. */
export const sideIcons = {
  'working-tree': 'edit',
  branch: 'git-branch',
  tag: 'tag',
  'merge-base': 'git-merge',
  commit: 'git-commit',
} as const
