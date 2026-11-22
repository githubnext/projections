import type {Pair} from '../projections/pairs.js'
import {plural} from '../plural.ts'
import type {Choice, RepositoryFacts} from './model.ts'
import {resolveChoice, unavailableReason} from './resolve.ts'
import {choiceDetail, choiceName} from './names.ts'
import {escapeMarkdown, shortCommit} from './recent.ts'

/** What a choice is for, in a sentence, for its tooltip. */
export function choiceMeaning(choice: Choice, facts: RepositoryFacts): string {
  const id = choice.id
  if (id === 'now') return 'Each projection of your files as they are now, with nothing compared.'
  if (id === 'uncommitted') return 'What your uncommitted edits change: the last commit compared with your files.'
  if (id === 'branch') {
    return `What your branch changes: where it left ${facts.defaultBranch ?? 'the default branch'} compared with your files, its commits and your uncommitted edits.`
  }
  if (id === 'last-commit') return 'What the last commit changed: the commit before it compared with it.'
  if (id === 'release') return 'Everything since the tag: the tag compared with the last commit.'
  if (id.startsWith('pr:')) return 'An open pull request: where it left its base compared with its head, locally.'
  if (id.startsWith('bookmark:')) return 'A comparison saved in .projections-bookmarks.json.'
  if (id.startsWith('pair:')) return 'A recent commit: the commit before it compared with it.'
  return 'Two revisions you chose: a Before compared with an After.'
}

/**
 * A choice row's description: a short fact or nothing, so it fits a narrow side bar. `1 file` (Uncommitted changes),
 * `3 commits` (Branch changes), a short commit (Last commit, a bookmark), `a1b2c3d → e4f5a6b` (two revisions), or
 * `unavailable`.
 */
export function choiceFact(choice: Choice, facts: RepositoryFacts, pair: Pair | undefined = resolveChoice(choice, facts)): string {
  if (unavailableReason(choice, facts)) return 'unavailable'
  const id = choice.id
  if (id === 'uncommitted') return facts.changes !== undefined && facts.changes !== 0 ? plural(facts.changes, 'file') : ''
  if (id === 'branch') {
    return facts.ahead !== undefined && facts.ahead !== 0
      ? plural(facts.ahead, 'commit')
      : facts.changes !== undefined && facts.changes !== 0
        ? plural(facts.changes, 'file')
        : ''
  }
  if (id === 'last-commit') return facts.head ? shortCommit(facts.head) : ''
  if (id.startsWith('bookmark:') && pair) return shortCommit(pair.after === 'working-tree' && pair.before ? pair.before : pair.after)
  if ((id === 'custom' || id.startsWith('pair:')) && pair) return pairFact(pair)
  return ''
}

/** Two revisions as a short fact: `a1b2c3d → e4f5a6b`, `main → working tree`. */
export function pairFact(pair: Pair): string {
  return pair.before ? `${shortCommit(pair.before)} → ${shortCommit(pair.after)}` : shortCommit(pair.after)
}

/** A choice row's tooltip: its name, its span with real ref names and its size, what it means, and what a click does. */
export function choiceTooltip(
  choice: Choice,
  facts: RepositoryFacts,
  options: {
    detail?: string | undefined
    selected?: boolean
    pair?: Pair | undefined
  } = {},
): string {
  const reason = unavailableReason(choice, facts)
  const detail = options.detail ?? choiceDetail(choice, facts, undefined, options.pair)
  return [
    `**${escapeMarkdown(choiceName(choice, facts))}**${detail ? ` · ${escapeMarkdown(detail)}` : ''}`,
    '',
    choiceMeaning(choice, facts),
    '',
    reason
      ? `Not available here: ${escapeMarkdown(reason)}.`
      : options.selected
        ? 'Every projection tab shows this, unless it is pinned.'
        : 'Click to show this in every projection tab.',
  ].join('\n')
}
