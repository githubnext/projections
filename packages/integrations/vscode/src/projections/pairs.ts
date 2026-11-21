import type {RefNames} from '../labels.js'
import {record} from './definitions.ts'

/** A Before → After pair (or one revision, `after`). */
export interface Pair {
  before?: string
  after: string
}

/** A suggested or bookmarked pair, as `GET /api/pairs` lists them. */
export interface SuggestedPair extends Pair {
  label: string
  source: string
  identical?: boolean
}

/** `GET /api/pairs`, as the side bar uses it. */
export interface PairList {
  default: Pair | undefined
  suggestions: SuggestedPair[]
  bookmarks: (SuggestedPair & {id?: string; projection?: string})[]
  branches: string[]
  tags: string[]
  /** `HEAD`'s commit and branch, and whether the working tree has uncommitted changes. */
  head?: {branch?: string; commit?: string; dirty?: boolean}
  defaultBranch?: string
  /** The commits branches and tags name, and the merge base, for human-readable labels (`labels.ts`). */
  refs?: RefNames
}

/** A revision as people read it: the working tree, a short commit, or the ref as it is. */
export function refLabel(value: string): string {
  if (value === 'working-tree') return 'Working tree'
  return /^[0-9a-f]{40}$/.test(value) ? value.slice(0, 8) : value
}

/** `main → HEAD`, or one revision alone. */
export function pairLabel(pair: Pair): string {
  return pair.before ? `${refLabel(pair.before)} → ${refLabel(pair.after)}` : refLabel(pair.after)
}

/** Whether two pairs are the same. */
export function samePair(a: Pair | undefined, b: Pair | undefined): boolean {
  return Boolean(a && b && a.after === b.after && (a.before ?? '') === (b.before ?? ''))
}

/** The pair swapped; one revision stays as it is. */
export function swapped(pair: Pair): Pair {
  return pair.before ? {before: pair.after, after: pair.before} : pair
}

/** The number of changes in a comparison job's result (`GET /api/jobs/:id`), or undefined when it has none. */
export function jobChangeCount(job: unknown): number | undefined {
  const changes = record(record(record(job)?.comparison)?.comparison)?.changes
  return Array.isArray(changes) ? changes.filter(change => record(change)?.status !== 'unchanged').length : undefined
}

/** The comparison modes as the editor's title actions name them. */
export const modeTitles: Record<string, string> = {
  animated: 'Animated',
  'side-by-side': 'Side by Side',
  swipe: 'Swipe',
  diff: 'Diff',
}

/** The mode after `mode` among the available ones, for the title bar's mode toggle. */
export function nextMode(mode: string | undefined, modes: readonly string[]): string | undefined {
  if (!modes.length) return undefined
  const index = mode ? modes.indexOf(mode) : -1
  return modes[(index + 1) % modes.length]
}
