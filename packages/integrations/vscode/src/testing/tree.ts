import * as vscode from 'vscode'
import {testTree} from '../test-items.js'
import type {TestNode} from '../test-items.js'
import {range} from './state.js'
import type {TestState, Watched} from './state.js'

/** A node's test item: the one it had (when its file is the same), so its results stay, else a new one. */
function nodeItem(state: TestState, watched: Watched, node: TestNode, existing: vscode.TestItem | undefined, id: string, index: number) {
  const {folder} = watched
  const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1
  const uri = node.path ? vscode.Uri.joinPath(folder.uri, ...node.path.split('/')) : undefined
  const item = existing && existing.uri?.toString() === uri?.toString() ? existing : state.controller.createTestItem(id, node.label, uri)
  item.label = node.label
  // In the tree's order (checks, then cases at their lines), not by label.
  item.sortText = String(index).padStart(4, '0')
  item.description = [
    node.description,
    node.kind === 'projection' || node.kind === 'file' ? (multiRoot ? folder.name : undefined) : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  item.range = node.line
    ? range({path: node.path ?? '', line: node.line, column: node.column ?? 1})
    : node.kind === 'file'
      ? new vscode.Range(0, 0, 0, 0)
      : undefined
  const file = node.kind === 'file' ? watched.files.find(listed => listed.path === node.path) : undefined
  const problems = file?.diagnostics.map(item => (item.location ? `${item.message} (line ${item.location.line})` : item.message)).join('\n')
  item.error = problems ? new vscode.MarkdownString().appendText(problems) : undefined
  state.data.set(item, {folder, node})
  item.children.replace(node.children.map((child, at) => nodeItem(state, watched, child, item.children.get(child.id), child.id, at)))
  return item
}

/** The folder's tree (`testTree`) as test items, reusing the items it had so their results stay. */
export function applyTree(state: TestState, watched: Watched, projections: Array<{id: string; title: string}>): void {
  const {folder} = watched
  const nodes = testTree({projections, files: watched.files, reported: watched.reported})
  const errors = watched.files.map(file => file.diagnostics.map(item => item.message).join('\n'))
  const signature = JSON.stringify([nodes, errors])
  if (watched.applied === signature) return
  watched.applied = signature
  const prefix = `${folder.uri.toString()}|`
  const keep = new Set<string>()
  for (const [index, node] of nodes.entries()) {
    const id = prefix + node.id
    keep.add(id)
    const item = nodeItem(state, watched, node, state.controller.items.get(id), id, index)
    if (state.controller.items.get(id) !== item) state.controller.items.add(item)
  }
  for (const [id] of state.items()) if (id.startsWith(prefix) && !keep.has(id)) state.controller.items.delete(id)
}
