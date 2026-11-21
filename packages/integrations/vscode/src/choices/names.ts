import type {SideLabel} from '../labels.js'
import type {Pair} from '../projections/pairs.js'
import {plural} from '../plural.ts'
import {pairOf} from './model.ts'
import type {Choice, RepositoryFacts} from './model.ts'
import {resolveChoice, tag} from './resolve.ts'

const shortRef = (ref: string) => (ref === 'working-tree' ? 'working tree' : /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 8) : ref)

/**
 * A choice's name: `Current state`, `Uncommitted changes`, `Branch changes`, `PR #12`, `Last commit`, `Since v1.0`,
 * `Bookmark: …`, a recent commit's subject or its revisions, `Two revisions`.
 */
export function choiceName(choice: Choice, facts: RepositoryFacts): string {
  const id = choice.id
  if (id === 'now') return 'Current state'
  if (id === 'uncommitted') return 'Uncommitted changes'
  if (id === 'branch') return 'Branch changes'
  if (id === 'last-commit') return 'Last commit'
  if (id === 'release') {
    const before = tag(facts)?.before
    return before ? `Since ${before.replace(/^refs\/tags\//, '')}` : 'Release'
  }
  if (id.startsWith('pr:')) return `PR #${id.slice(3)}`
  if (id.startsWith('bookmark:')) {
    const key = id.slice('bookmark:'.length)
    return `Bookmark: ${facts.bookmarks.find(item => item.id === key)?.label ?? key}`
  }
  if (id.startsWith('pair:')) {
    const pair = choice.pair ?? pairOf(id)
    return choice.title ?? (pair ? pairNames(pair) : 'Two revisions')
  }
  return 'Two revisions'
}

/** What `HEAD` adds on a branch: `3 commits + 1 uncommitted`, `1 commit`, `2 uncommitted`, or `no changes`. */
export function branchDetail(facts: RepositoryFacts): string {
  const uncommitted = facts.dirty ? (facts.changes ? `${facts.changes} uncommitted` : 'uncommitted') : undefined
  const parts = [...(facts.ahead ? [plural(facts.ahead, 'commit')] : []), ...(uncommitted ? [uncommitted] : [])]
  return parts.length ? parts.join(' + ') : 'no changes'
}

/** The files a working-tree side reads as, for people. */
const yourFiles = 'your files'

/** The revisions a pair compares, by name: `main → feature/auth`, from their labels once git named them. */
export function pairNames(pair: Pair, labels?: {before?: SideLabel; after: SideLabel}): string {
  const before = labels?.before?.name ?? (pair.before ? shortRef(pair.before) : undefined)
  const after = labels?.after.name ?? shortRef(pair.after)
  return before ? `${before} → ${after}` : after
}

/**
 * What a choice adds to its name: its span with real ref names, then its size. `your files as they are now` (Current
 * state), `last commit → your files · 1 file` (Uncommitted changes), `main → your files · 3 commits + 1 uncommitted`
 * (Branch changes), `#12 Fix login · main → fix-login` (a pull request), or the revisions a pair compares.
 */
export function choiceDetail(
  choice: Choice,
  facts: RepositoryFacts,
  labels?: {before?: SideLabel; after: SideLabel},
  pair: Pair | undefined = resolveChoice(choice, facts),
): string {
  const id = choice.id
  if (id === 'now') return `${yourFiles} as they are now`
  if (id === 'uncommitted') {
    return `last commit → ${yourFiles} · ${facts.changes ? plural(facts.changes, 'file') : facts.dirty ? 'uncommitted' : 'no edits'}`
  }
  if (id === 'branch') return `${facts.defaultBranch ?? 'the default branch'} → ${yourFiles} · ${branchDetail(facts)}`
  if (id === 'last-commit') return 'previous commit → last commit'
  if (id.startsWith('pr:')) {
    return [choice.title ?? `#${id.slice(3)}`, ...(pair ? [pairNames(pair, labels).replaceAll('working tree', yourFiles)] : [])].join(' · ')
  }
  // A pair named by its revisions needs no detail; a titled one (a commit subject) shows them.
  if (id.startsWith('pair:') && !choice.title) return ''
  return pair ? pairNames(pair, labels).replace(/^working tree$|(?<=→ )working tree$/, yourFiles) : ''
}

/** `Branch changes · main → your files · 3 commits + 1 uncommitted`. */
export function choiceText(choice: Choice, facts: RepositoryFacts, labels?: {before?: SideLabel; after: SideLabel}, pair?: Pair): string {
  const detail = choiceDetail(choice, facts, labels, pair)
  return detail ? `${choiceName(choice, facts)} · ${detail}` : choiceName(choice, facts)
}

/** The codicon for a choice. */
export function choiceIcon(choice: Choice): string {
  const id = choice.id
  if (id === 'now') return 'eye'
  if (id === 'uncommitted') return 'edit'
  if (id === 'branch') return 'git-branch'
  if (id === 'last-commit') return 'git-commit'
  if (id === 'release') return 'tag'
  if (id.startsWith('pr:')) return 'git-pull-request'
  if (id.startsWith('bookmark:')) return 'bookmark'
  if (id.startsWith('pair:')) return 'git-commit'
  return 'git-compare'
}
