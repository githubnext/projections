// The Viewing view's rows as lookups and tests know them: by key, and as the tree shows them.
import * as vscode from 'vscode'
import type {Node} from './types.js'

type Recent = Extract<Node, {kind: 'recent'}>

/** A row's key: a choice's id (`now`, `bookmark:<id>`, …), `recent:<before>..<after>`, `group:<name>`, else its kind. */
export function rowKey(node: Node): string {
  if (node.kind === 'choice') return node.choice.id
  if (node.kind === 'recent') return `recent:${node.change.key}`
  if (node.kind === 'group') return `group:${node.group}`
  return node.kind
}

/** A row as the view shows it (`item`), and for a recent commit whether its thumbnail rendered. */
export function shownRow(node: Node, item: vscode.TreeItem, thumbnail: (node: Recent) => boolean) {
  return {
    kind: node.kind,
    id: rowKey(node),
    label: typeof item.label === 'string' ? item.label : (item.label?.label ?? ''),
    description: typeof item.description === 'string' ? item.description : null,
    checked: item.iconPath instanceof vscode.ThemeIcon && item.iconPath.id === 'check',
    accessibility: item.accessibilityInformation?.label ?? null,
    contextValue: item.contextValue ?? null,
    tooltip: item.tooltip instanceof vscode.MarkdownString ? item.tooltip.value : (item.tooltip ?? null),
    ...(node.kind === 'recent' ? {thumbnail: thumbnail(node)} : {}),
  }
}
