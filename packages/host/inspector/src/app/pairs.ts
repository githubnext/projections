import type {InspectorPair, InspectorPairs, InspectorRevision} from '../types.js'
import {optionalText, record} from '../client/guards.js'
import {refName, workingTree} from './revisions.js'

export interface Marks {
  a?: string | undefined
  b?: string | undefined
}
/** Whether a stored value is marks. */
export const isMarks = (value: unknown): value is Marks => record(value) && optionalText(value.a) && optionalText(value.b)
/** Whether a stored value is a list of marks. */
export const isMarksList = (value: unknown): value is Marks[] => Array.isArray(value) && value.every(isMarks)

/**
 * The Before → After pair a repository opens on, from the history the Inspector API lists: `HEAD~1 → HEAD`; with
 * one commit, `HEAD → Working tree` when the tree has changes, else `HEAD` alone; without commits, the working tree.
 * Used only when the runner doesn't suggest pairs (`GET /api/pairs`), whose default comes first: the first bookmark, the
 * branch since the default branch, the previous tag, then `HEAD~1 → HEAD`, skipping pairs with identical sides.
 */
export function defaultPair(revisions: readonly Pick<InspectorRevision, 'ref' | 'dirty'>[]): Marks {
  const commits = revisions.filter(item => item.ref !== workingTree).length
  if (commits >= 2) return {a: 'HEAD~1', b: 'HEAD'}
  if (commits === 1) return revisions.find(item => item.ref === workingTree)?.dirty ? {a: 'HEAD', b: workingTree} : {b: 'HEAD'}
  return {b: workingTree}
}
/** A suggested pair as marks. */
export const suggestedMarks = (pair: InspectorPair): Marks => (pair.before ? {a: pair.before, b: pair.after} : {b: pair.after})
/** What a suggested pair is, under its label in the Pairs list. */
export function pairDetail(pair: InspectorPair): string {
  switch (pair.source) {
    case 'bookmark':
      return pair.identical ? 'Bookmark · no changes' : 'Bookmark'
    case 'merge-base':
      return 'Since the default branch'
    case 'tag':
      return 'Since the previous tag'
    case 'parent':
      return 'The last commit'
    case 'working-tree':
      return 'Your uncommitted changes'
    case 'head':
      break
  }
  return 'One revision'
}
/** How a pair reads: "HEAD~1 → HEAD", or one revision's name. */
export const pairLabel = (pair: Marks) =>
  pair.a ? `${refName(pair.a)} → ${refName(pair.b ?? workingTree)}` : refName(pair.b ?? workingTree)
/** How a ref reads in the Explorer and status line. */

/**
 * Chooses mark `letter` for `key`, or clears it when `key` already has it.
 * Marking the other side's revision swaps them, so A and B never coincide.
 */
export function marking(current: Marks, letter: 'A' | 'B', key: string): Marks {
  const side = letter === 'A' ? 'a' : 'b'
  if (current[side] === key) return {...current, [side]: undefined}
  const next = {...current, [side]: key}
  if (letter === 'A' && current.b === key) next.b = current.a
  if (letter === 'B' && current.a === key) next.a = current.b
  return next
}

/** A pair offered in the Explorer's Pairs list: what it is, and a bookmark's name. */
export interface PairSuggestion {
  pair: Marks
  detail: string
  title?: string | undefined
}

/**
 * The Pairs list: the runner's suggestions (without it, the default pair and the uncommitted changes), then the
 * recently used pairs, each pair once.
 */
export function suggestedPairs(
  pairsHere: InspectorPairs | null | undefined,
  revisions: readonly Pick<InspectorRevision, 'ref' | 'dirty'>[],
  recent: readonly Marks[],
): PairSuggestion[] {
  const list: PairSuggestion[] = []
  const push = (pair: Marks, detail: string, title?: string) => {
    if (pair.a && pair.b && !list.some(item => item.pair.a === pair.a && item.pair.b === pair.b)) list.push({pair, detail, title})
  }
  if (pairsHere) {
    const fallback = pairsHere.default
    for (const pair of pairsHere.suggestions) {
      if (pair.error) continue
      const isDefault = pair.before === fallback.before && pair.after === fallback.after
      push(
        suggestedMarks(pair),
        isDefault ? `Default · ${pairDetail(pair)}` : pairDetail(pair),
        pair.source === 'bookmark' ? pair.label : undefined,
      )
    }
  } else {
    push(defaultPair(revisions), 'Default')
    push({a: 'HEAD', b: workingTree}, 'Your uncommitted changes')
  }
  for (const pair of recent) push(pair, 'Recent')
  return list
}
