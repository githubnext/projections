import {listedChoices} from './listing.ts'
import {pairChoiceId, sameChoice} from './model.ts'
import type {Choice, RepositoryFacts} from './model.ts'
import type {RecentChange} from './recent.ts'

/** The state of the run over the recent commits, as the Recent changes group shows it. */
export interface RecentState {
  /** `none` until it first runs. */
  status: 'none' | 'running' | 'done' | 'cancelled' | 'failed'
  changes: readonly RecentChange[]
  /** `Checking recent commits… 3 of 10`. */
  progress?: string
}

export type ViewingRow =
  | {kind: 'choice'; choice: Choice; selected: boolean}
  | {kind: 'pr'}
  | {
      kind: 'group'
      group: 'bookmarks' | 'recent'
      expanded: boolean
      children: ViewingRow[]
    }
  | {kind: 'recent'; change: RecentChange; selected: boolean}
  | {kind: 'progress'; text: string}
  | {kind: 'find'; text: string}
  | {kind: 'compare'; selected: boolean}

/**
 * The Viewing view's rows: Current state, Uncommitted changes, Branch changes (the current pull request too), Pull
 * request…; Bookmarks (when there are any); Recent changes (Last commit, Since <tag>, then the recent commits that
 * change any projection); Compare two revisions…. Choices that resolve to the same pair are listed once, the selected
 * one always (`listedChoices`), and the recent commit at `HEAD` replaces Last commit (unless Last commit is chosen).
 * Exactly one row is selected: the choice's, else Compare two revisions….
 */
export function viewingRows(input: {facts: RepositoryFacts; current: Choice; recent: RecentState}): ViewingRow[] {
  const {facts, current, recent} = input
  const {main, recent: listed, bookmarks} = listedChoices(facts, current)
  const choiceRow = (choice: Choice): ViewingRow => ({kind: 'choice', choice, selected: sameChoice(choice, current)})
  // The recent commit at `HEAD` is Last commit: listed once, as the commit (it says what it changes), unless Last commit
  // is the choice.
  const atHead = recent.changes.find(change => facts.head && change.after === facts.head)
  const lastChosen = current.id === 'last-commit'
  const spans = atHead && !lastChosen ? listed.filter(choice => choice.id !== 'last-commit') : listed
  const changes = recent.changes.filter(change => change !== atHead || !lastChosen)
  const recentRows: ViewingRow[] = [
    ...spans.map(choiceRow),
    ...(recent.status === 'running'
      ? [
          {
            kind: 'progress' as const,
            text: recent.progress || 'Checking recent commits…',
          },
        ]
      : []),
    ...changes.map(change => ({
      kind: 'recent' as const,
      change,
      selected: current.id === pairChoiceId({before: change.before, after: change.after}),
    })),
    ...(recent.status === 'none'
      ? [{kind: 'find' as const, text: 'Find recent changes'}]
      : recent.status !== 'running' && !changes.length
        ? [
            {
              kind: 'find' as const,
              text:
                recent.status === 'failed'
                  ? 'Checking recent commits failed: try again'
                  : recent.status === 'cancelled'
                    ? 'Checking recent commits cancelled: try again'
                    : 'No recent commit changes a projection',
            },
          ]
        : []),
  ]
  const selectedSomewhere = (rows: readonly ViewingRow[]): boolean =>
    rows.some(row => (row.kind === 'group' ? selectedSomewhere(row.children) : 'selected' in row && row.selected))
  const bookmarkRows = bookmarks.map(choiceRow)
  const rows: ViewingRow[] = [
    ...main.map(choiceRow),
    {kind: 'pr'},
    ...(bookmarkRows.length
      ? [
          {
            kind: 'group' as const,
            group: 'bookmarks' as const,
            expanded: selectedSomewhere(bookmarkRows),
            children: bookmarkRows,
          },
        ]
      : []),
    {
      kind: 'group',
      group: 'recent',
      expanded: selectedSomewhere(recentRows) || recent.status === 'running',
      children: recentRows,
    },
  ]
  return [...rows, {kind: 'compare', selected: !selectedSomewhere(rows)}]
}

/** Every row, groups' children after their group, for tests and lookups. */
export function flatRows(rows: readonly ViewingRow[]): ViewingRow[] {
  return rows.flatMap(row => (row.kind === 'group' ? [row, ...flatRows(row.children)] : [row]))
}
