// What a choice shows: the pair it resolves to from what the repository says, the automatic choice before anyone picks,
// why a choice doesn't apply here, and the choice a pair is. Like the rest of `choices/`, nothing here imports VS Code.

import {type Pair, samePair} from '../projections/pairs.ts'
import {pairOf, type Choice, type RepositoryFacts} from './model.ts'

/** The repository's latest release tag, from its suggestions. */
export const tag = (facts: RepositoryFacts) => facts.suggestions.find(item => item.source === 'tag')

/** Whether `HEAD` is ahead of the default branch: on another branch whose merge base isn't `HEAD`. */
export function isAhead(facts: RepositoryFacts): boolean {
  return Boolean(facts.mergeBase && facts.head && facts.mergeBase !== facts.head)
}

/**
 * The choice a repository opens on before anyone picks: Branch changes when it's ahead, else Uncommitted changes with
 * edits, else Current state. Never one the quick pick hides: Branch changes needs commits ahead, so it is never
 * Uncommitted changes' equivalent.
 */
export function automaticChoice(facts: RepositoryFacts): Choice {
  if (isAhead(facts)) return {id: 'branch'}
  if (facts.dirty && facts.head) return {id: 'uncommitted'}
  return {id: 'now'}
}

/** The pair a choice shows now, or none when it doesn't apply here (Branch changes on the default branch, say). */
export function resolveChoice(choice: Choice, facts: RepositoryFacts): Pair | undefined {
  const id = choice.id
  if (id === 'now') return {after: 'working-tree'}
  if (id === 'uncommitted') return facts.head ? {before: 'HEAD', after: 'working-tree'} : undefined
  if (id === 'branch') return facts.mergeBase ? {before: facts.mergeBase, after: 'working-tree'} : undefined
  if (id === 'last-commit') return facts.suggestions.some(item => item.source === 'parent') ? {before: 'HEAD~1', after: 'HEAD'} : undefined
  if (id === 'release') {
    const found = tag(facts)
    return found ? {...(found.before ? {before: found.before} : {}), after: found.after} : undefined
  }
  if (id.startsWith('bookmark:')) {
    const found = facts.bookmarks.find(item => item.id === id.slice('bookmark:'.length))
    return found ? {...(found.before ? {before: found.before} : {}), after: found.after} : undefined
  }
  if (id.startsWith('pair:')) return choice.pair ?? pairOf(id)
  if (id === 'custom' || id.startsWith('pr:')) return choice.pair
  return undefined
}

/** Why a choice doesn't apply here, for the picker. */
export function unavailableReason(choice: Choice, facts: RepositoryFacts): string | undefined {
  if (resolveChoice(choice, facts)) return undefined
  if (choice.id === 'uncommitted' || choice.id === 'last-commit') return facts.head ? 'no earlier commit' : 'no commits yet'
  if (choice.id === 'branch') {
    return facts.branch && facts.branch === facts.defaultBranch
      ? `you're on ${facts.branch}`
      : facts.defaultBranch
        ? `no merge base with ${facts.defaultBranch}`
        : 'no default branch'
  }
  if (choice.id === 'release') return 'no earlier tag'
  return 'not here'
}

/**
 * What a remembered choice shows now: it, resolved again (refs move: the merge base, `HEAD`), or, when it no longer
 * applies, the automatic choice. `automatic` says the person hasn't picked (or their pick doesn't apply here).
 */
export function effectiveChoice(remembered: Choice | undefined, facts: RepositoryFacts): {choice: Choice; pair: Pair; automatic: boolean} {
  const pair = remembered ? resolveChoice(remembered, facts) : undefined
  if (remembered && pair) return {choice: remembered, pair, automatic: false}
  const automatic = automaticChoice(facts)
  return {choice: automatic, pair: resolveChoice(automatic, facts) ?? {after: 'working-tree'}, automatic: true}
}

/** The choice a pair is, when one names it (from Swap or an agent tool), else two revisions (`custom`). */
export function identifyPair(pair: Pair, facts: RepositoryFacts): Choice {
  for (const id of ['now', 'uncommitted', 'branch', 'last-commit', 'release']) if (samePair(resolveChoice({id}, facts), pair)) return {id}
  const bookmark = facts.bookmarks.find(item => item.id && samePair(item, pair))
  if (bookmark) return {id: `bookmark:${bookmark.id}`}
  return {id: 'custom', pair: {...(pair.before ? {before: pair.before} : {}), after: pair.after}}
}
