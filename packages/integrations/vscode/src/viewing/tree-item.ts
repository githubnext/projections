import * as vscode from 'vscode'
import type {Node, ViewingItem} from './types.js'

/** A presented row as the native tree shows it, its id scoped to its folder. */
export function treeItem(node: Node, shown: ViewingItem): vscode.TreeItem {
  const item = new vscode.TreeItem(
    shown.label,
    shown.collapsed === undefined
      ? vscode.TreeItemCollapsibleState.None
      : shown.collapsed
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded,
  )
  item.id = `${node.model.folder.uri.toString()}#viewing:${shown.key}`
  if (shown.description !== undefined) item.description = shown.description
  if (shown.icon) item.iconPath = new vscode.ThemeIcon(shown.icon)
  if (shown.tooltip) item.tooltip = shown.tooltip
  if (shown.command) item.command = shown.command
  if (shown.context) item.contextValue = shown.context.join(' ')
  if (node.kind !== 'group') item.accessibilityInformation = {label: shown.accessibility}
  return item
}
