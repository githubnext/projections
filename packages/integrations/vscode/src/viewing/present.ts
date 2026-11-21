import * as vscode from 'vscode'
import {changedProjections, escapeMarkdown, recentTooltip, shortCommit} from '../choices/recent.js'
import {choiceFact, choiceTooltip, pairFact} from '../choices/tooltips.js'
import {resolveChoice} from '../choices/resolve.js'
import type {FolderModel} from '../folder-model.js'
import type {Node, ViewingItem} from './types.js'

/** What presenting a row needs beyond the row: the branch's pull request, a recent commit's thumbnail, Last commit's changes. */
export interface PresentContext {
  pull(model: FolderModel): {branch: string; number?: number | undefined} | undefined
  thumbnail(model: FolderModel, key: string): string | null | undefined
  lastCommitChanges(model: FolderModel): string
}

type Of<Kind extends Node['kind']> = Extract<Node, {kind: Kind}>

/** A row with its check, its accessibility label and, when it is the choice, its `current` context. */
const row = (item: Omit<ViewingItem, 'accessibility'> & {accessibility?: string}): ViewingItem => ({
  ...item,
  // State is the check and the accessibility label, never the tree's selection or focus.
  ...(item.selected ? {icon: 'check'} : {}),
  accessibility:
    item.accessibility ?? `${item.label}${item.description ? `, ${item.description}` : ''}${item.selected ? ', selected' : ''}`,
  ...(item.context ? {context: [...item.context, ...(item.selected ? ['current'] : [])]} : {}),
})

function group(node: Of<'group'>): ViewingItem {
  return {
    key: node.group,
    label: node.group === 'bookmarks' ? 'Bookmarks' : 'Recent changes',
    selected: false,
    collapsed: !node.expanded,
    context: [`viewing-group-${node.group}`],
    tooltip:
      node.group === 'bookmarks'
        ? 'Comparisons saved in .projections-bookmarks.json'
        : 'The last commit, everything since a tag, and the recent commits that change any projection',
    accessibility: node.group === 'bookmarks' ? 'Bookmarks' : 'Recent changes',
  }
}

function pullRequest(node: Of<'pr'>, context: PresentContext): ViewingItem {
  const {model} = node
  const pull = context.pull(model)
  const description = pull?.number !== undefined && pull.branch === model.pairs?.head?.branch ? `#${pull.number}` : ''
  return row({
    key: 'pr',
    label: 'Pull request…',
    description,
    selected: false,
    context: ['viewing-pr'],
    tooltip: new vscode.MarkdownString(
      [
        '**Pull request…**',
        '',
        'An open pull request: where it left its base compared with its head, locally.',
        ...(description ? ['', `This branch has ${description} open.`] : []),
        '',
        'Click to choose one.',
      ].join('\n'),
    ),
    command: {title: 'Pull Request…', command: 'projections.choosePullRequest', arguments: [model.folder.uri]},
  })
}

function compare(node: Of<'compare'>): ViewingItem {
  const {model} = node
  const pair = model.pair
  return row({
    key: 'compare',
    label: 'Compare two revisions…',
    description: node.selected && pair?.before ? pairFact(pair) : '',
    selected: node.selected,
    tooltip: new vscode.MarkdownString(
      [
        '**Compare two revisions…**',
        '',
        'Choose a Before and an After: a branch, a tag, a commit or your files.',
        ...(node.selected && pair ? ['', `Every projection tab compares \`${escapeMarkdown(pairFact(pair))}\`, unless it is pinned.`] : []),
      ].join('\n'),
    ),
    command: {title: 'Compare Two Revisions…', command: 'projections.choosePair', arguments: [model.folder.uri]},
    // Swap is two revisions' only: reversing a named choice makes no sense.
    context: ['viewing-compare', ...(node.selected && pair?.before ? ['swappable', 'bookmarkable'] : [])],
  })
}

function recent(node: Of<'recent'>, context: PresentContext): ViewingItem {
  const {change} = node
  const thumbnail = context.thumbnail(node.model, change.key)
  const description = shortCommit(change.after)
  return row({
    key: `recent:${change.key}`,
    label: change.title,
    description,
    icon: 'git-commit',
    selected: node.selected,
    tooltip: new vscode.MarkdownString(recentTooltip(change, thumbnail ?? undefined)),
    command: {title: 'Show This', command: 'projections.viewing.choose', arguments: [node]},
    context: ['viewing-recent', 'bookmarkable', 'removable'],
    accessibility: `${change.title}, ${description}, changes ${changedProjections(change)}${node.selected ? ', selected' : ''}`,
  })
}

function choice(node: Of<'choice'>, context: PresentContext): ViewingItem {
  const {model} = node
  const facts = model.facts()
  const pair = node.selected ? model.pair : resolveChoice(node.choice, facts)
  const shown = model.describe(node.choice, pair)
  const bookmark = node.choice.id.startsWith('bookmark:')
  return row({
    key: `choice:${node.choice.id}`,
    label: shown.name,
    description: choiceFact(node.choice, facts, pair),
    selected: node.selected,
    tooltip: new vscode.MarkdownString(
      choiceTooltip(node.choice, facts, {
        detail: shown.detail,
        selected: node.selected,
        pair,
      }) + (node.choice.id === 'last-commit' ? context.lastCommitChanges(model) : ''),
    ),
    command: {title: 'Show This', command: 'projections.viewing.choose', arguments: [node]},
    context: [
      bookmark ? 'viewing-bookmark' : 'viewing-choice',
      ...(bookmark ? ['removable'] : node.selected && pair?.before ? ['bookmarkable'] : []),
    ],
  })
}

/**
 * A row as both surfaces show it, the one item model the view's tree items and the quick pick's items are built
 * from: its label, short fact, icon (the check when it is the choice), tooltip, click and inline actions.
 */
export function present(node: Node, context: PresentContext): ViewingItem {
  switch (node.kind) {
    case 'group':
      return group(node)
    case 'pr':
      return pullRequest(node, context)
    case 'compare':
      return compare(node)
    case 'progress':
      return {key: 'progress', label: node.text, icon: 'loading~spin', selected: false, accessibility: node.text}
    case 'find':
      return {
        key: 'find',
        label: node.text,
        icon: 'search',
        selected: false,
        tooltip: 'Check the recent commits for the ones that change any projection',
        command: {title: 'Find Recent Changes', command: 'projections.findRecentChanges', arguments: [node]},
        accessibility: node.text,
      }
    case 'recent':
      return recent(node, context)
    case 'choice':
      return choice(node, context)
  }
  throw new TypeError('Unknown viewing node')
}
