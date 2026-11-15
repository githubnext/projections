import type {DevelopCell, DevelopChange} from '../develop-model.js'
import {plural} from '../plural.ts'

/*
 * The Viewing view's model, which its quick pick shares: its rows (Current state, Uncommitted changes, Branch changes,
 * Pull request…, then Bookmarks and Recent changes, then Compare two revisions…), equivalents hidden; each row's short
 * fact (its description: a count, a short commit or nothing) and the explanation its tooltip carries; and the recent
 * commits that change any projection, from a `/api/sweep` run over every projection. The section's title stays
 * "Viewing": the status bar item names the choice.
 */

/** A revision as the Viewing view's rows show it: a commit's short SHA (7), the working tree, or a ref verbatim. */
export function shortCommit(ref: string): string {
  if (ref === 'working-tree') return 'working tree'
  return /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref
}

/** Markdown with what a commit subject or a name could make of it escaped. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+!<>|~]/g, '\\$&')
}

/** A commit that changes at least one projection, from a run over the recent commits. */
export interface RecentChange {
  /** `<before>..<after>`, the commits. */
  key: string
  before: string
  after: string
  /** The commit's subject (a merged pull request's title). */
  title: string
  date?: string
  /** The projections it changes, in the run's order, with how many changes each. */
  projections: Array<{id: string; title: string; changes: number}>
}

/** The most recent commits that change a projection the Viewing view lists. */
export const recentLimit = 10

/**
 * The recent commits that change any projection, newest first as the run lists them: each with the projections it
 * changes (a changed cell). Pairs the run was given (`kind: pair`) and hidden ones are left out.
 */
export function recentChanges(input: {
  changes: readonly DevelopChange[]
  cells: readonly DevelopCell[]
  title?: (id: string) => string
  hidden?: ReadonlySet<string>
  limit?: number
}): RecentChange[] {
  const found: RecentChange[] = []
  for (const change of input.changes) {
    if (change.kind === 'pair') continue
    const key = `${change.before}..${change.after}`
    if (input.hidden?.has(key)) continue
    const projections = input.cells
      .filter(cell => cell.before === change.before && cell.after === change.after && cell.status === 'changed')
      .map(cell => ({id: cell.projection, title: input.title?.(cell.projection) ?? cell.projection, changes: cell.changes ?? 0}))
    if (!projections.length) continue
    found.push({
      key,
      before: change.before,
      after: change.after,
      title: change.title || shortCommit(change.after),
      ...(change.date ? {date: change.date} : {}),
      projections,
    })
    if (found.length >= (input.limit ?? recentLimit)) break
  }
  return found
}

/** What a recent commit changes, in a sentence: `Packages (3 changes), Cards (1 change)`. */
export function changedProjections(change: Pick<RecentChange, 'projections'>): string {
  return change.projections.map(item => `${item.title} (${plural(item.changes, 'change')})`).join(', ')
}

/** A recent commit's tooltip: its subject, its commits, what it changes, its thumbnail when there is one. */
export function recentTooltip(change: RecentChange, thumbnail?: string): string {
  return [
    `**${escapeMarkdown(change.title)}**`,
    '',
    `\`${shortCommit(change.before)}\` → \`${shortCommit(change.after)}\`${change.date ? ` · ${change.date.slice(0, 10)}` : ''}`,
    '',
    `Changes ${escapeMarkdown(changedProjections(change))}.`,
    ...(thumbnail ? ['', `![What it changes in ${escapeMarkdown(change.projections[0]!.title)}](${thumbnail})`] : []),
    '',
    'Click to show it in every projection tab.',
  ].join('\n')
}
