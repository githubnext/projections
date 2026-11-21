// The status bar item: the readout of what the projection tabs show, the Viewing choice of the folder the Viewing view
// shows, as the projector mark and the choice's short name (`statusItem`), with a warning while the tab in front is out
// of date, and a spinning `sync` instead while that tab's job runs (after a moment, and for at least a moment:
// `runningIndicator`). VS Code doesn't stop `~spin` under its reduce motion, so the item does: a still `sync` then.
// Its tooltip has the details; its click opens the Viewing quick pick. Shown only while the folder defines projections,
// and only where projections are in view: a projection tab is the active editor tab, or a Projections view is visible.
import * as vscode from 'vscode'
import {statusItem, statusShown} from './choices/status.js'
import {projectionViewType} from './decorations.js'
import type {FolderModel} from './folder-model.js'
import type {Sidebar} from './sidebar.js'
import {coalesce} from './updates.js'
import {pairFileCount} from './refs.js'
import type {Pair} from './projections/pairs.js'
import {runningIndicator} from '@githubnext/projections-host-vscode/running'
import type {Running} from '@githubnext/projections-host-vscode/running'

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('projections.pair', vscode.StatusBarAlignment.Left, 50)
  /** How many files differ in the shown pair: its folder and pair, the `changes` generation it was counted at, and the count. */
  private files: {pair: string; generation: number; count?: number | undefined} | undefined
  /** Whether the item is shown, for tests. */
  private visible = false
  /** Whether the folder has a readout (it defines projections and has a pair). */
  private readout = false
  /** Where the item shows, once a turn: moving focus between a projection tab and the side bar never hides it on the way. */
  private readonly place = coalesce(() => this.apply())
  /** The tab in front's job, as the item shows it: after a moment, for at least a moment. */
  private readonly running = runningIndicator(() => this.update())
  /** The tab in front the running job is that of (its folder and projection). */
  private runningTab: string | undefined
  private readonly disposables: vscode.Disposable[] = [this.item]

  constructor(
    private readonly sidebar: Sidebar,
    /** The folder the Viewing view shows. */
    private readonly folder: () => FolderModel | undefined,
    /** The Projections views (any of them visible counts as the side bar's). */
    private readonly views: readonly vscode.TreeView<unknown>[],
    /** What the jobs of a folder's projection tabs other than the one in front are doing. */
    private readonly others: (folder: vscode.WorkspaceFolder) => readonly Running[] = () => [],
  ) {
    this.item.name = 'Projections viewing'
    const moved = () => this.place.request()
    this.disposables.push(
      sidebar.onDidUpdateStatus(() => this.update()),
      vscode.window.tabGroups.onDidChangeTabs(moved),
      vscode.window.tabGroups.onDidChangeTabGroups(moved),
      ...views.map(view => view.onDidChangeVisibility(moved)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('workbench.reduceMotion')) this.update()
      }),
    )
    this.update()
  }

  /** Shows the readout where projections are in view, and hides it elsewhere. */
  private apply() {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    const shown = statusShown(this.readout, {
      projectionTab: input instanceof vscode.TabInputCustom && input.viewType === projectionViewType,
      views: this.views.map(view => view.visible),
    })
    if (shown === this.visible) return
    this.visible = shown
    if (shown) this.item.show()
    else this.item.hide()
  }

  update() {
    const model = this.folder()
    const pair = model?.pair
    const active = this.sidebar.active
    const pinned = active?.pinned && active.folder === model?.folder ? active.pinned : undefined
    // Another tab in front starts afresh: its job shows after the delay, and the last one's doesn't linger.
    const front = model && active?.folder === model.folder ? active : undefined
    const tab = front ? `${front.folder.uri.toString()}#${front.projection}` : undefined
    if (tab !== this.runningTab) {
      this.runningTab = tab
      this.running.reset()
    }
    this.running.set(front?.running)
    const running = this.running.current
    const shown =
      model &&
      statusItem({
        defines: model.defines,
        choice: model.choice,
        facts: model.facts(),
        pair,
        labels: model.labels(pair),
        files: pair ? this.count(model, pair) : undefined,
        stale: model.outOfDateCount(),
        pinned: pinned ? {title: active!.title, name: model.describe(pinned, pinned.pair).name} : undefined,
        running: running && front ? {title: front.title, kind: running, still: this.still(front.reducedMotion)} : undefined,
        others: this.others(model.folder),
        front: active?.stale && active.folder === model.folder ? {title: active.title, files: active.stale.files} : undefined,
        folder: (vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? model.folder.name : undefined,
      })
    this.readout = Boolean(model && shown)
    if (!model || !shown) return this.apply()
    this.item.text = shown.text
    // A new tooltip only when it says something new, so an open hover doesn't flicker.
    if (!(this.item.tooltip instanceof vscode.MarkdownString) || this.item.tooltip.value !== shown.tooltip) {
      this.item.tooltip = new vscode.MarkdownString(shown.tooltip)
    }
    this.item.accessibilityInformation = {label: shown.accessibility}
    this.item.command = {title: 'Choose What to Show…', command: 'projections.changePair', arguments: [model.folder.uri]}
    this.apply()
  }

  /**
   * Whether the spinner holds still: VS Code's reduce motion on, or `auto` (its default) and the tab's page moving less,
   * as VS Code tells a webview (`vscode-reduce-motion`, which follows the system under `auto`) or the system does.
   */
  private still(reported: boolean | undefined): boolean {
    const setting = vscode.workspace.getConfiguration('workbench').get<string>('reduceMotion')
    return setting === 'on' || (setting !== 'off' && Boolean(reported))
  }

  /** The files the pair changes, once git says; counted again after a change in the folder, the last count standing meanwhile. */
  private count(model: FolderModel, pair: Pair): number | undefined {
    if (!pair.before) return undefined
    const key = `${model.folder.uri.toString()}#${pair.before}..${pair.after}`
    const generation = model.generation
    if (this.files?.pair === key && this.files.generation === generation) return this.files.count
    const count = this.files?.pair === key ? this.files.count : undefined
    this.files = {pair: key, generation, count}
    void pairFileCount(model.folder.uri.fsPath, pair.before, pair.after).then(files => {
      if (this.files?.pair !== key || this.files.generation !== generation) return
      this.files.count = files
      this.update()
    })
    return count
  }

  /** For tests: what the item shows, once the side bar's pending update has run. */
  state() {
    this.sidebar.flush()
    this.place.flush()
    return {
      visible: this.visible,
      text: this.item.text || null,
      tooltip: this.item.tooltip instanceof vscode.MarkdownString ? this.item.tooltip.value : (this.item.tooltip ?? null),
      accessibility: this.item.accessibilityInformation?.label ?? null,
      command: typeof this.item.command === 'object' ? this.item.command.command : (this.item.command ?? null),
      arguments: typeof this.item.command === 'object' ? (this.item.command.arguments ?? []).map(String) : [],
      icon: /^\$\(([^)]+)\)/.exec(this.item.text)?.[1] ?? null,
    }
  }

  dispose() {
    this.place.dispose()
    this.running.dispose()
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }
}
