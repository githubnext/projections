import * as vscode from 'vscode'
import {pairFact} from '../choices/tooltips.js'
import type {RecentChange} from '../choices/recent.js'
import {addBookmark, removeBookmark} from '../develop-model.js'
import type {FolderModel} from '../folder-model.js'
import type {Pair} from '../projections/pairs.js'
import type {Sidebar} from '../sidebar.js'
import type {Node, ViewingHost} from './types.js'

const bookmarksFile = (model: FolderModel) => vscode.Uri.joinPath(model.folder.uri, '.projections-bookmarks.json')

/** The revisions a row bookmarks, its title and the projections it changes: a recent commit's, or the current choice's. */
function bookmarked(node: Node): {pair: Pair | undefined; title: string; changes: RecentChange['projections']} {
  const {model} = node
  if (node.kind === 'recent')
    return {pair: {before: node.change.before, after: node.change.after}, title: node.change.title, changes: node.change.projections}
  const pair = model.pair
  const shown = model.describe()
  return {pair, title: model.choice.title ?? (model.choice.id === 'custom' && pair ? pairFact(pair) : shown.name), changes: []}
}

/**
 * Bookmark: writes the row's revisions (a recent commit's, or the current choice's, at their commits) to
 * `.projections-bookmarks.json`, as `projections adopt` does, for the projection in front (else one it changes, else
 * the first).
 */
export async function bookmark(node: Node, host: ViewingHost, sidebar: Sidebar) {
  const {model} = node
  const {pair, title, changes} = bookmarked(node)
  if (!pair?.before) return
  const [before, after] = await host.resolveCommits(model.folder.uri.fsPath, [pair.before, pair.after])
  const active = sidebar.active
  const projection =
    (active && active.folder === model.folder && (!changes.length || changes.some(item => item.id === active.projection))
      ? active.projection
      : undefined) ??
    changes[0]?.id ??
    model.projections[0]?.id
  if (!projection) return
  const file = bookmarksFile(model)
  const current = await vscode.workspace.fs.readFile(file).then(
    bytes => new TextDecoder().decode(bytes),
    () => undefined,
  )
  const {text} = addBookmark(current, {
    projectionId: projection,
    before: before ?? pair.before,
    after: pair.after === 'working-tree' ? 'working-tree' : (after ?? pair.after),
    title,
  })
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(text))
  await model.refresh()
}

/** Removes a bookmark from the file. */
export async function removeBookmarkOf(model: FolderModel, id: string) {
  const file = bookmarksFile(model)
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file))
  await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(removeBookmark(text, id)))
  await model.refresh()
}
