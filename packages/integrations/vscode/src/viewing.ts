// The Viewing view: everything that changes what the projection tabs show, as a native list first in the Projections
// view container. Current state, Uncommitted changes, Branch changes, Pull request…; Bookmarks; Recent changes (Last
// commit, Since <tag>, and the recent commits that change any projection, found through `/api/sweep` over every
// projection); Compare two revisions…. A click sets the repository's choice, which every unpinned tab follows. Rows say
// short facts (a count, a short commit) and explain themselves in their tooltips; the current row has a check. The
// view's title stays "Viewing": the status bar item names the choice, and its click opens the Viewing quick pick, the
// same rows (one item model, `present`) grouped by separators, with Show in Side Bar last.
import * as vscode from 'vscode'
import {changedProjections, escapeMarkdown} from './choices/recent.js'
import {flatRows, viewingRows} from './choices/viewing-rows.js'
import {pairChoiceId} from './choices/model.js'
import {unavailableReason} from './choices/resolve.js'
import type {FolderModel} from './folder-model.js'
import {count} from './probe.js'
import type {Sidebar} from './sidebar.js'
import {changed} from './updates.js'
import {bookmark, removeBookmarkOf} from './viewing/bookmarks.js'
import {pickItems, type PickItem} from './viewing/pick-items.js'
import {present, type PresentContext} from './viewing/present.js'
import {PullRequests} from './viewing/pull-requests.js'
import {RecentCommits} from './viewing/recent-commits.js'
import {rowKey, shownRow} from './viewing/rows.js'
import {treeItem} from './viewing/tree-item.js'
import type {Node, ViewingHost, ViewingItem} from './viewing/types.js'
import {noop} from './noop.ts'

export class ViewingView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  readonly view: vscode.TreeView<Node>
  private readonly recent: RecentCommits
  private readonly pulls: PullRequests
  private readonly disposables: vscode.Disposable[] = []
  private readonly context: PresentContext = {
    pull: model => this.pulls.get(model),
    thumbnail: (model, key) => this.recent.state(model).thumbnails.get(key),
    lastCommitChanges: model => this.lastCommitChanges(model),
  }

  /** For tests: how many times recent commits were checked. */
  get finds() {
    return this.recent.finds
  }

  private readonly sidebar: Sidebar
  private readonly host: ViewingHost

  constructor(sidebar: Sidebar, host: ViewingHost) {
    this.sidebar = sidebar
    this.host = host
    this.recent = new RecentCommits(host, () => this.changed.fire(undefined))
    this.pulls = new PullRequests(host, () => this.changed.fire(undefined))
    this.view = vscode.window.createTreeView('projections.viewing', {treeDataProvider: this})
    this.disposables.push(
      this.view,
      this.changed,
      this.changed.event(() => count('viewing.refresh')),
      sidebar.onDidUpdate(() => this.refresh()),
      vscode.window.onDidChangeActiveColorTheme(() => {
        for (const [key, recent] of this.recent.entries()) {
          const model = this.sidebar.modelFor(vscode.Uri.parse(key))
          if (model) void this.recent.renderThumbnails(model, recent)
        }
      }),
      vscode.commands.registerCommand('projections.viewing.choose', (node?: Node) => node && this.choose(node)),
      vscode.commands.registerCommand('projections.viewing.bookmark', (node?: Node) => node && this.bookmark(node)),
      vscode.commands.registerCommand('projections.viewing.remove', (node?: Node) => node && this.remove(node)),
      vscode.commands.registerCommand('projections.findRecentChanges', (argument?: unknown) => {
        const model = (argument as Node | undefined)?.model ?? this.model()
        return model ? this.recent.find(model) : undefined
      }),
    )
    this.refresh()
  }

  /** The folder whose choice it shows (the status bar's too): the active projection tab's, else the first that defines projections. */
  model(): FolderModel | undefined {
    const folders = vscode.workspace.workspaceFolders ?? []
    const folder = this.sidebar.active?.folder ?? folders.find(item => this.sidebar.model(item).defines) ?? folders[0]
    return folder && this.sidebar.model(folder)
  }

  /** What the view shows, to tell whether the side bar's update changed it. */
  private readonly shown = changed()

  private refresh() {
    const model = this.model()
    if (model) this.pulls.lookUp(model)
    // The side bar updates once for a pick (and again as tabs report); the rows redraw only when they changed.
    if (this.shown(this.rows().rows)) this.changed.fire(undefined)
  }

  getChildren(node?: Node): Node[] {
    if (node?.kind === 'group') {
      // Expanding Recent changes the first time checks the recent commits.
      if (node.group === 'recent' && !this.recent.state(node.model).sweep) void this.recent.find(node.model, false).catch(noop)
      return node.children.map(row => ({...row, model: node.model}))
    }
    if (node) return []
    const model = this.model()
    return model ? this.top(model) : []
  }

  /** A folder's rows, groups with their children: what the view lists and the quick pick shows. */
  private top(model: FolderModel): Node[] {
    if (!model.defines) return []
    return viewingRows({facts: model.facts(), current: model.choice, recent: this.recent.recentState(model)}).map(row => ({...row, model}))
  }

  private present(node: Node): ViewingItem {
    return present(node, this.context)
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return treeItem(node, this.present(node))
  }

  /**
   * The Viewing quick pick (the status bar item's click, Choose What to Show…): the view's rows for a folder, built from
   * the same item model, its groups as separators, then Show in Side Bar. Picking one does what its click does.
   */
  pickItems(model: FolderModel): PickItem[] {
    return pickItems(model, this.top(model), node => this.present(node))
  }

  /** What the last commit changes, when the recent commits were checked: a line for Last commit's tooltip. */
  private lastCommitChanges(model: FolderModel): string {
    const head = model.facts().head
    const found = this.recent.recentState(model).changes.find(change => change.after === head)
    return found ? `\n\nChanges ${escapeMarkdown(changedProjections(found))}.` : ''
  }

  /** A row's click: its choice, a recent commit, or why it isn't available. */
  private choose(node: Node) {
    const {model} = node
    if (node.kind === 'recent') {
      const pair = {before: node.change.before, after: node.change.after}
      model.choose({id: pairChoiceId(pair), pair, title: node.change.title})
      return
    }
    if (node.kind !== 'choice') return
    const reason = unavailableReason(node.choice, model.facts())
    if (reason) {
      void vscode.window.showInformationMessage(`Projections: ${model.describe(node.choice, undefined).name} isn't available: ${reason}`)
      return
    }
    model.choose(node.choice)
  }

  /** Find Recent Changes: the last commits, each checked with every projection, then thumbnails of those that change one. */
  find(model: FolderModel, reveal = true) {
    return this.recent.find(model, reveal)
  }

  private bookmark(node: Node) {
    return bookmark(node, this.host, this.sidebar)
  }

  /** Remove: a bookmark from the file, a recent commit from view. */
  private async remove(node: Node) {
    if (node.kind === 'choice' && node.choice.id.startsWith('bookmark:')) {
      await removeBookmarkOf(node.model, node.choice.id.slice('bookmark:'.length))
    } else if (node.kind === 'recent') {
      this.recent.state(node.model).hidden.add(node.change.key)
      this.changed.fire(undefined)
    }
  }

  /** Every row (groups' children too), for tests and lookups. */
  private nodes(): Node[] {
    const top = this.getChildren()
    const model = top[0]?.model
    return model ? flatRows(top).map(row => ({...row, model})) : []
  }

  /** For tests: the title and the rows as the view shows them (groups' children after them). */
  rows() {
    const rows = this.nodes().map(node =>
      shownRow(node, this.getTreeItem(node), recent => Boolean(this.recent.state(recent.model).thumbnails.get(recent.change.key))),
    )
    return {title: this.view.title ?? null, description: this.view.description ?? null, rows}
  }

  /** A row's click (by its id: `now`, `uncommitted`, `bookmark:<id>`, `recent:<before>..<after>`, `compare`, …), or its inline action. */
  activate(key: string, action: 'choose' | 'bookmark' | 'remove' = 'choose') {
    const node = this.nodes().find(item => rowKey(item) === key)
    if (!node) throw new Error(`No ${key} row in the Viewing view`)
    if (action === 'bookmark') return this.bookmark(node)
    if (action === 'remove') return this.remove(node)
    const command = this.getTreeItem(node).command
    if (!command) throw new Error(`The ${key} row does nothing on a click`)
    const args: unknown[] = command.arguments ?? []
    return vscode.commands.executeCommand(command.command, ...args)
  }

  dispose() {
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }
}
