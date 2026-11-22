import type {Pair} from '../projections/pairs.js'
import {sameChoice, type Choice, type RepositoryFacts} from './model.ts'
import {resolveChoice} from './resolve.ts'

/** A pair as it compares commits: `HEAD` read as its commit, so equivalent choices compare equal. */
function resolvedKey(pair: Pair, facts: RepositoryFacts): string {
  const at = (ref: string | undefined) => (ref === 'HEAD' && facts.head ? facts.head : (ref ?? ''))
  return `${at(pair.before)}..${at(pair.after)}`
}

/**
 * The choices the Viewing quick pick lists: none resolving to the same pair as one listed before it (Branch changes
 * on the default branch is Uncommitted changes), except the selected one, which always stays. Unavailable choices
 * (no pair) stay, with why.
 */
export function visibleChoices(choices: readonly Choice[], facts: RepositoryFacts, selected?: Choice): Choice[] {
  const seen = new Map<string, Choice>()
  const shown: Choice[] = []
  for (const choice of choices) {
    // Branch changes without a merge base (on the default branch) is Uncommitted changes.
    const pair =
      resolveChoice(choice, facts) ?? (choice.id === 'branch' && facts.head ? {before: facts.head, after: 'working-tree'} : undefined)
    const key = pair && resolvedKey(pair, facts)
    const chosen = sameChoice(choice, selected)
    if (key && seen.has(key) && !chosen) continue
    if (key && chosen) {
      // The selected one replaces an equivalent listed before it.
      const earlier = seen.get(key)
      if (earlier && !sameChoice(earlier, selected)) shown.splice(shown.indexOf(earlier), 1)
    }
    if (key) seen.set(key, choice)
    shown.push(choice)
  }
  return shown
}

/**
 * The choices the Viewing view and the quick pick list, equivalents hidden (`visibleChoices`): `main` holds Current
 * state, Uncommitted changes, Branch changes and the current pull request; `recent` Last commit and Since <tag>;
 * `bookmarks` the bookmarks. `more` is `recent` then `bookmarks`.
 */
export function listedChoices(
  facts: RepositoryFacts,
  current: Choice,
): {main: Choice[]; recent: Choice[]; bookmarks: Choice[]; more: Choice[]} {
  const visible = visibleChoices(
    [
      {id: 'now'},
      {id: 'uncommitted'},
      {id: 'branch'},
      ...(current.id.startsWith('pr:') ? [current] : []),
      {id: 'last-commit'},
      ...(facts.suggestions.some(item => item.source === 'tag') ? [{id: 'release'}] : []),
      ...facts.bookmarks.flatMap(item => (item.id ? [{id: `bookmark:${item.id}`}] : [])),
    ],
    facts,
    current,
  )
  const recent = visible.filter(choice => choice.id === 'last-commit' || choice.id === 'release')
  const bookmarks = visible.filter(choice => choice.id.startsWith('bookmark:'))
  return {
    main: visible.filter(choice => !recent.includes(choice) && !bookmarks.includes(choice)),
    recent,
    bookmarks,
    more: [...recent, ...bookmarks],
  }
}
