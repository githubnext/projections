import {runningText} from '@githubnext/projections-host-vscode/running'
import type {Running} from '@githubnext/projections-host-vscode/running'
import type {SideLabel} from '../labels.js'
import type {Pair} from '../projections/pairs.js'
import {plural} from '../plural.ts'
import type {Choice, RepositoryFacts} from './model.ts'
import {branchDetail, choiceName} from './names.ts'
import {escapeMarkdown} from './recent.ts'
import {markIcon, outOfDateIcon, pairName, runningIcon, sideDetail, statusName} from './status-names.ts'

export interface StatusInput {
  /** Whether the folder defines projections: the item shows only then. */
  defines: boolean
  choice: Choice
  facts: RepositoryFacts
  pair: Pair | undefined
  labels?: {before?: SideLabel; after: SideLabel} | undefined
  /** How many files differ between Before and After, once git said. */
  files?: number | undefined
  /** How many projections' results are out of date. */
  stale?: number
  /** The projection tab in front, when its result is out of date: its title and how many files changed since. */
  front?: {title: string; files?: number | undefined} | undefined
  /**
   * The projection tab in front, while its job runs (shown after a moment, `runningIndicator`): its title, what the job
   * does, and whether the icon holds still (reduced motion). It takes the warning's place until the job ends.
   */
  running?: {title: string; kind: Running; still?: boolean | undefined} | undefined
  /** What the other projection tabs' jobs in the folder are doing, one entry a tab: only the tooltip counts them. */
  others?: readonly Running[] | undefined
  /** The projection tab in front, when it is pinned to another choice. */
  pinned?: {title: string; name: string} | undefined
  /** The folder, when the window has several. */
  folder?: string | undefined
}

/** Where the person is: whether a projection tab is the active editor tab, and which Projections views are visible. */
export interface StatusPlace {
  projectionTab: boolean
  views: readonly boolean[]
}

/**
 * Whether the status bar item shows its readout: only where projections are in view, while a projection tab is the
 * active editor tab or any Projections view is visible; editing other files with the side bar closed, it is hidden.
 */
export function statusShown(readout: boolean, place: StatusPlace): boolean {
  return readout && (place.projectionTab || place.views.some(Boolean))
}

/** The status bar item: its text, its Markdown tooltip and its accessible label; none without projections or a pair. */
export function statusItem(input: StatusInput): {text: string; tooltip: string; accessibility: string} | undefined {
  const {choice, facts, pair, labels} = input
  if (!input.defines || !pair) return undefined
  const name = statusName(choice, facts, pair, labels)
  const stale = input.stale ?? 0
  const running = input.running
  // While the tab in front's job runs, it isn't out of date yet: the spinner takes the warning's place.
  const front = running ? undefined : input.front
  const others = input.others ?? []
  // A commit subject could hold `$(…)`, which the status bar would draw as an icon. The icons follow the tab in front.
  const icon = running ? ` ${runningIcon(running.still)}` : front ? ` ${outOfDateIcon}` : ''
  const text = `${markIcon} ${name.replace(/\$\(/g, '\\$(')}${icon}`
  const full =
    choice.id === 'custom' || (choice.id.startsWith('pair:') && !choice.title) ? pairName(pair, labels) : choiceName(choice, facts)
  const span = pair.before
    ? `${sideDetail(pair.before, labels?.before)} → ${sideDetail(pair.after, labels?.after)}`
    : `${sideDetail(pair.after, labels?.after)}${pair.after === 'working-tree' ? ', as they are now' : ''}`
  const size = [
    ...(choice.id === 'uncommitted' && facts.changes !== undefined && facts.changes !== 0
      ? [`${plural(facts.changes, 'file')} uncommitted`]
      : []),
    ...(choice.id === 'branch' ? [branchDetail(facts)] : []),
    ...(pair.before && input.files !== undefined ? [`${plural(input.files, 'file')} changed`] : []),
  ]
  const pullTitle = choice.id.startsWith('pr:') && choice.title ? choice.title.replace(/^#\d+\s*/, '') : undefined
  const tooltip = [
    `**${escapeMarkdown(full)}**${input.folder ? ` in ${escapeMarkdown(input.folder)}` : ''}`,
    ...(pullTitle ? ['', escapeMarkdown(pullTitle)] : []),
    '',
    span,
    ...(size.length ? ['', size.join(' · ')] : []),
    ...(running ? ['', `${escapeMarkdown(running.title)}: ${runningText(running.kind)}`] : []),
    ...(others.length
      ? ['', `${plural(others.length, 'other tab')} ${others.every(kind => kind === 'comparing') ? 'comparing' : 'extracting'}.`]
      : []),
    ...(front
      ? [
          '',
          `${escapeMarkdown(front.title)} is out of date${front.files !== undefined && front.files !== 0 ? `: ${plural(front.files, 'file')} changed since its result` : ''}. Click to refresh it.`,
        ]
      : []),
    ...(stale
      ? [
          '',
          `${plural(stale, 'projection')} ${stale === 1 ? 'is' : 'are'} out of date: the files changed since ${stale === 1 ? 'its' : 'their'} result. Refresh ${stale === 1 ? 'its tab' : 'their tabs'} to update ${stale === 1 ? 'it' : 'them'}.`,
        ]
      : []),
    ...(input.pinned
      ? ['', `${escapeMarkdown(input.pinned.title)} is pinned to ${escapeMarkdown(input.pinned.name)}; it doesn't follow this.`]
      : []),
    '',
    'Click to choose what projections show.',
  ].join('\n')
  return {
    text,
    tooltip,
    accessibility: `Projections: viewing ${full}${running ? `, ${running.kind}` : front ? ', out of date' : ''}`,
  }
}

/** The Viewing quick pick's first item while the tab in front is out of date: `$(refresh) Refresh · 19 files changed`. */
export function refreshPickLabel(front: {files?: number | undefined} | undefined): string | undefined {
  if (!front) return undefined
  return `$(refresh) Refresh${front.files !== undefined && front.files !== 0 ? ` · ${plural(front.files, 'file')} changed` : ''}`
}
