import type {SideLabel} from '../labels.js'
import type {Pair} from '../projections/pairs.js'
import type {Choice, RepositoryFacts} from './model.ts'
import {choiceName} from './names.ts'
import {escapeMarkdown, shortCommit} from './recent.ts'

/*
 * The status bar item's readout of the Viewing choice: the projector mark and the choice's short human name, nothing
 * the editor tab already shows (the projection, its change counts) and no hashes or counts. The tooltip carries the
 * details: the exact revisions with their commits, the span's size and the files changed, and why results are out of
 * date (the item itself only ends with a warning while the tab in front is), and what a tab's job is doing (the item
 * ends with a spinning `sync` while the tab in front's runs).
 */

/** How long a commit subject (a bookmark, a recent change) may be in the status bar before it is cut with "…". */
export const subjectLimit = 24
/** How long each side's name may be in a two-revision comparison. */
export const refLimit = 20
/** The product icon (`contributes.icons`): the Projections mark. */
export const markIcon = '$(projections-mark)'
/** Added while the tab in front is out of date. */
export const outOfDateIcon = '$(warning)'
/** Added while the tab in front's job runs, in place of the warning: spinning, or still under reduced motion. */
export const runningIcon = (still?: boolean) => (still ? '$(sync)' : '$(sync~spin)')

/** `text`, or its first `limit - 1` characters and "…" when longer. */
export function truncate(text: string, limit: number): string {
  const characters = Array.from(text.trim())
  return characters.length <= limit
    ? characters.join('')
    : `${characters
        .slice(0, limit - 1)
        .join('')
        .trimEnd()}…`
}

/** A side as the status bar names it: `your files`, a branch or tag, else its short commit (7). */
function sideName(ref: string, label: SideLabel | undefined): string {
  if (ref === 'working-tree' || label?.kind === 'working-tree') return 'your files'
  if (label?.kind === 'commit') return label.commit ? shortCommit(label.commit) : label.name
  return label?.name ?? shortCommit(ref)
}

/** Two revisions as the status bar names them: `main → feature/auth`, a short commit only when nothing names it. */
export function pairName(pair: Pair, labels?: {before?: SideLabel; after: SideLabel}): string {
  const after = truncate(sideName(pair.after, labels?.after), refLimit)
  return pair.before ? `${truncate(sideName(pair.before, labels?.before), refLimit)} → ${after}` : after
}

/**
 * The choice's short human name: `Current state`, `Uncommitted changes`, `Branch changes`, `PR #123`, `Last commit`,
 * `Since v1.0`; a bookmark or recent change by its subject, cut at about 24 characters; two revisions by their names.
 */
export function statusName(
  choice: Choice,
  facts: RepositoryFacts,
  pair: Pair | undefined,
  labels?: {before?: SideLabel; after: SideLabel},
): string {
  const id = choice.id
  if (id.startsWith('bookmark:')) {
    const key = id.slice('bookmark:'.length)
    return truncate(facts.bookmarks.find(item => item.id === key)?.label ?? key, subjectLimit)
  }
  if (id.startsWith('pair:')) return choice.title ? truncate(choice.title, subjectLimit) : pair ? pairName(pair, labels) : 'Two revisions'
  if (id === 'custom') return pair ? pairName(pair, labels) : 'Two revisions'
  return truncate(choiceName(choice, facts), subjectLimit)
}

/** A side in the tooltip: its name and its commit, `` main `a1b2c3d` ``, or `your files`. */
export function sideDetail(ref: string, label: SideLabel | undefined): string {
  if (ref === 'working-tree' || label?.kind === 'working-tree') return 'your files'
  const commit = label?.commit ?? (/^[0-9a-f]{40}$/.test(ref) ? ref : undefined)
  const name = label?.name ?? ref
  if (commit && (label?.kind === 'commit' || name === commit || name === commit.slice(0, 8))) return `\`${shortCommit(commit)}\``
  return commit ? `${escapeMarkdown(name)} \`${shortCommit(commit)}\`` : escapeMarkdown(name)
}
