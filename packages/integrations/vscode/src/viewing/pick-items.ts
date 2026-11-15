import * as vscode from 'vscode'
import type {FolderModel} from '../folder-model.js'
import type {Node, ViewingItem} from './types.js'

export type PickItem = vscode.QuickPickItem & {command?: vscode.Command; current?: boolean}

/**
 * The Viewing quick pick (the status bar item's click, Choose What to Show…): the view's rows for a folder, built from
 * the same item model, its groups as separators, then Show in Side Bar. Picking one does what its click does.
 */
export function pickItems(model: FolderModel, top: readonly Node[], present: (node: Node) => ViewingItem): PickItem[] {
  const items: PickItem[] = []
  const add = (node: Node) => {
    const shown = present(node)
    // Every item has an icon (blank for none) so the labels line up under the check.
    items.push({
      label: `$(${shown.icon ?? 'blank'}) ${shown.label.replace(/\$\(/g, '\\$(')}`,
      ...(shown.description ? {description: shown.description} : {}),
      ...(shown.command ? {command: shown.command} : {}),
      ...(shown.selected ? {current: true} : {}),
    })
  }
  const separator = (label: string) => items.push({label, kind: vscode.QuickPickItemKind.Separator})
  for (const node of top) {
    if (node.kind === 'group') {
      separator(present(node).label)
      // The group's children as listed, without expanding it (which would check the recent commits).
      for (const child of node.children) add({...child, model})
      continue
    }
    // Compare two revisions… follows the groups in the view; here it needs its own separator to leave them.
    if (node.kind === 'compare') separator('')
    add(node)
  }
  separator('')
  items.push({
    label: '$(projections-mark) Show in Side Bar',
    command: {title: 'Show in Side Bar', command: 'projections.viewing.focus'},
  })
  return items
}
