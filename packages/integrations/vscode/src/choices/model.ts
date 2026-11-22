/*
 * What projection tabs look at, as one choice rather than two revisions: Current state (your files alone), Uncommitted
 * changes, Branch changes, a pull request, Last commit, a release, a bookmark, a recent commit, or two revisions. A choice
 * resolves to a Before → After pair from what the repository says (`GET /api/pairs` and git; `resolve.ts`), and keeps its identity
 * (`now`, `uncommitted`, `branch`, … stay internal) so the Viewing control and the status bar name the choice rather
 * than its refs. Nothing here imports VS Code, so it is unit tested on its own: its modules import each other with `.ts`
 * specifiers, which Node loads from source.
 */

import {type Pair, type SuggestedPair, samePair} from '../projections/pairs.ts'

/**
 * A choice: its identity (`now`, `uncommitted`, `branch`, `pr:<n>`, `last-commit`, `release`, `bookmark:<id>`,
 * `pair:<before>..<after>` (a recent commit chosen in the Viewing view) or `custom` (Compare two revisions…)) and, for a
 * pull request, a recent commit or two revisions, the pair it resolved to and its title, which the repository can't
 * resolve again.
 */
export interface Choice {
  id: string
  pair?: Pair
  /** A pull request's `#12 Fix the login`, or a found pair's commit subject. */
  title?: string
}

/** What the repository says, for resolving choices and naming them. */
export interface RepositoryFacts {
  /** `HEAD`'s commit; none in a repository without commits. */
  head?: string
  branch?: string
  defaultBranch?: string
  /** The merge base of `HEAD` with the default branch, when `HEAD` is on another branch. */
  mergeBase?: string
  /** Whether the working tree has uncommitted changes. */
  dirty: boolean
  /** How many files are uncommitted (changed and untracked). */
  changes?: number
  /** How many commits `HEAD` is ahead of the merge base. */
  ahead?: number
  /** `GET /api/pairs`' suggestions (by `source`: `merge-base`, `working-tree`, `parent`, `tag`, `bookmark`). */
  suggestions: SuggestedPair[]
  bookmarks: (SuggestedPair & {id?: string})[]
}

/** A pair choice's identity, `pair:<before>..<after>`, for a recent commit chosen in the Viewing view. */
export function pairChoiceId(pair: Pair): string {
  return `pair:${pair.before ?? ''}..${pair.after}`
}

/** The pair a `pair:<before>..<after>` identity names. */
export const pairOf = (id: string): Pair | undefined => {
  const match = /^pair:(.*)\.\.(.+)$/.exec(id)
  return match ? {...(match[1] ? {before: match[1]} : {}), after: match[2]!} : undefined
}

/** Whether two choices are the same choice (a custom pair or a pull request also by its pair). */
export function sameChoice(a: Choice | undefined, b: Choice | undefined): boolean {
  if (!a || !b || a.id !== b.id) return false
  return a.id === 'custom' ? samePair(a.pair, b.pair) : true
}

/** A choice's identity, if it is one this extension knows (for commands and remembered state). */
export function isChoice(value: unknown): value is Choice {
  const choice = value as Partial<Choice> | null
  if (typeof choice?.id !== 'string') return false
  const known =
    ['now', 'uncommitted', 'branch', 'last-commit', 'release', 'custom'].includes(choice.id) ||
    /^pr:\d+$/.test(choice.id) ||
    /^bookmark:.+$/.test(choice.id) ||
    /^pair:.*\.\..+$/.test(choice.id)
  const pair = choice.pair as Partial<Pair> | undefined
  const pairOk = pair === undefined || (typeof pair.after === 'string' && (pair.before === undefined || typeof pair.before === 'string'))
  return known && pairOk && (choice.id === 'custom' || choice.id.startsWith('pr:') ? Boolean(pair) : true)
}
