import * as vscode from 'vscode'
import type {Lease} from './backends.js'
import {byTitle, candidateReason} from './projections/definitions.js'
import {rendererIcon} from './projections/rows.js'
import type {Choice} from './choices/model.js'
import {count} from './probe.js'
import {changed, coalesce} from './updates.js'
import {rowStatus} from './row-status.js'
import {SidebarDiagnostics} from './sidebar/diagnostics.js'
import {sidebarItem} from './sidebar/items.js'
import type {Node} from './sidebar/items.js'
import type {Pair} from './projections/pairs.js'
import type {Running} from '@githubnext/projections-host-vscode/running'
import {FolderModel} from './folder-model.js'
import {RowDecorations, rowUri} from './decorations.js'

/** Whether Suggested offers Add to CI… (after the first adoption, until it is used). */
const offerAddToCiKey = 'projections.offerAddToCi'

/** The tab the person is looking at, for the status bar and the editor's title actions. */
export interface ActiveTab {
  folder: vscode.WorkspaceFolder
  projection: string
  title: string
  /** The choice the tab is pinned to, with the pair it resolved to. */
  pinned?: (Choice & {pair: Pair}) | undefined
  /** When its result is out of date: how many files changed since, when known. */
  stale?: {files?: number | undefined} | undefined
  /** What its job is doing while one runs (its page's report): extracting, or comparing. */
  running?: Running | undefined
  /** Whether its page moves less (VS Code's reduce motion, or the system's). */
  reducedMotion?: boolean | undefined
}

/**
 * The Projections activity bar container's **Projections** view (one row per projection, like files, with its change
 * count as a badge; a leaf that opens its tab; invalid definitions as failed rows) and **Suggested** (the projections
 * that apply here and aren't defined, each with Adopt), shown only while there are some. Definition files that don't
 * load get Problems diagnostics.
 */

export class Sidebar implements vscode.Disposable {
  private readonly models = new Map<string, FolderModel>()
  private readonly projectionsChanged = new vscode.EventEmitter<Node | undefined>()
  private readonly suggestedChanged = new vscode.EventEmitter<Node | undefined>()
  private readonly decorations = new RowDecorations()
  private readonly updated = new vscode.EventEmitter<void>()
  /** Any folder's definitions, pair, labels or counts changed. */
  readonly onDidUpdate = this.updated.event
  private readonly statusChanged = new vscode.EventEmitter<void>()
  /** The status bar item (`StatusBar`) should read the choice again: a folder or the active tab changed. */
  readonly onDidUpdateStatus = this.statusChanged.event
  /** The projection tab in front, set by the extension as tabs become active. */
  active: ActiveTab | undefined
  private readonly diagnostics = new SidebarDiagnostics(() => this.models.values())
  private readonly disposables: vscode.Disposable[] = []
  readonly projectionsView: vscode.TreeView<Node>
  readonly suggestedView: vscode.TreeView<Node>

  constructor(
    private readonly lease: (folder: vscode.WorkspaceFolder) => Lease,
    private readonly output: vscode.LogOutputChannel,
    private readonly memento: vscode.Memento,
  ) {
    const projections: vscode.TreeDataProvider<Node> = {
      onDidChangeTreeData: this.projectionsChanged.event,
      getTreeItem: node => this.item(node),
      getChildren: node => this.projectionChildren(node),
      // For `reveal`: a row's parent is its folder's row when several folders are open.
      getParent: node =>
        node.kind === 'problem'
          ? {kind: 'invalid', model: node.model, invalid: node.invalid}
          : (node.kind === 'projection' || node.kind === 'invalid') && this.models.size > 1
            ? {kind: 'folder', model: node.model}
            : undefined,
    }
    const suggested: vscode.TreeDataProvider<Node> = {
      onDidChangeTreeData: this.suggestedChanged.event,
      getTreeItem: node => this.item(node),
      getChildren: node => this.suggestedChildren(node),
    }
    this.projectionsView = vscode.window.createTreeView('projections.projections', {treeDataProvider: projections, showCollapseAll: true})
    this.suggestedView = vscode.window.createTreeView('projections.suggested', {treeDataProvider: suggested})
    this.disposables.push(
      this.projectionsView,
      this.statusChanged,
      this.updated,
      this.suggestedView,
      vscode.window.registerFileDecorationProvider(this.decorations),
      this.decorations,
      this.diagnostics,
      this.projectionsChanged,
      this.suggestedChanged,
      this.projectionsChanged.event(() => count('projections.refresh')),
      this.decorations.onDidChangeFileDecorations(() => count('projections.decorations')),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.sync()),
    )
    void vscode.commands.executeCommand('setContext', 'projections.offerAddToCi', this.memento.get<boolean>(offerAddToCiKey) === true)
    this.sync()
  }

  /** Suggested offers Add to CI… after the first adoption, until it is used. */
  offerAddToCi(on: boolean) {
    void this.memento.update(offerAddToCiKey, on)
    void vscode.commands.executeCommand('setContext', 'projections.offerAddToCi', on)
  }

  /** A model for each workspace folder (each holds the folder's backend while the side bar or a tab uses it). */
  private sync() {
    const folders = vscode.workspace.workspaceFolders ?? []
    for (const [key, model] of this.models) {
      if (!folders.some(folder => folder.uri.toString() === key)) {
        model.dispose()
        this.models.delete(key)
      }
    }
    for (const folder of folders) this.model(folder)
    this.changed()
  }

  model(folder: vscode.WorkspaceFolder): FolderModel {
    const key = folder.uri.toString()
    let model = this.models.get(key)
    if (!model) {
      model = new FolderModel(folder, this.lease(folder), this.output, this.memento)
      this.models.set(key, model)
      model.onDidChange(() => this.changed())
      void model.load()
    }
    return model
  }

  modelFor(uri: vscode.Uri): FolderModel | undefined {
    return [...this.models.values()].find(model => model.folder.uri.toString() === uri.toString())
  }

  /** Re-reads every folder. */
  async refresh(): Promise<void> {
    await Promise.all([...this.models.values()].map(model => model.refresh()))
  }

  /**
   * One update for a burst of changes (a pick changes the choice, the tabs that follow it, their rows and labels in one
   * turn): the trees are told only when what they show changed, so a row doesn't redraw for nothing.
   */
  private readonly update = coalesce(() => this.render())
  private readonly projectionsShown = changed()
  private readonly suggestedShown = changed()

  private changed() {
    this.update.request()
  }

  /** What a tree item shows, to tell whether a tree changed. */
  private shown(node: Node) {
    const item = this.item(node)
    const icon = item.iconPath
    return [
      typeof item.label === 'string' ? item.label : (item.label?.label ?? ''),
      item.description ?? '',
      item.tooltip instanceof vscode.MarkdownString ? item.tooltip.value : (item.tooltip ?? ''),
      icon instanceof vscode.ThemeIcon ? icon.id : icon ? 'uri' : '',
      item.contextValue ?? '',
      item.collapsibleState ?? 0,
      item.id ?? '',
    ]
  }

  private render() {
    const models = [...this.models.values()]
    void vscode.commands.executeCommand(
      'setContext',
      'projections.hasDefinitions',
      models.some(model => model.defines),
    )
    void vscode.commands.executeCommand(
      'setContext',
      'projections.loaded',
      models.every(model => model.definitions || model.error),
    )
    void vscode.commands.executeCommand(
      'setContext',
      'projections.hasSuggestions',
      models.some(model => model.candidates.some(candidate => !candidate.adopted)),
    )
    this.diagnostics.publish()
    this.decorations.set(
      models.flatMap(model =>
        model.projections.map(definition => ({
          uri: rowUri(model.folder, definition.id),
          status: rowStatus(model.status(definition.id), model.pair ? model.describe().name : undefined),
        })),
      ),
    )
    const shown = models.map(model => ({
      folder: model.folder.uri.toString(),
      defines: model.defines,
      error: model.error ?? null,
      projections: this.folderRows(model).map(node => this.shown(node)),
      suggested: this.candidateRows(model).map(node => this.shown(node)),
    }))
    if (this.projectionsShown(shown.map(({suggested: _, ...rest}) => rest))) this.projectionsChanged.fire(undefined)
    if (this.suggestedShown(shown.map(item => [item.folder, item.suggested]))) this.suggestedChanged.fire(undefined)
    // The badge: how many projections changed in the folders' choices, as far as they have been compared.
    const changed = models.reduce((total, model) => total + model.changedCount(), 0)
    const pairs = models.flatMap(model => (model.pair && model.defines ? [model.describe().name] : []))
    this.projectionsView.badge = changed
      ? {value: changed, tooltip: `${changed} projection${changed === 1 ? '' : 's'} changed in ${pairs.join(', ')}`}
      : undefined
    this.updateStatus()
    this.updated.fire()
  }

  /** Tells the status bar item to read the choice again. */
  updateStatus() {
    this.statusChanged.fire()
  }

  /** Brings the side bar (and the status bar item it tells) up to date at once, for tests. */
  flush() {
    this.update.flush()
  }

  /** The diagnostics a tab's shown extractions report (by side), as native diagnostics on the definition file. */
  reportExtraction(folder: vscode.WorkspaceFolder, projection: string, definition: vscode.Uri | undefined, messages: string[]) {
    this.diagnostics.reportExtraction(folder, projection, definition, messages)
  }

  /** For tests: the diagnostics on a file. */
  diagnosticsFor(uri: vscode.Uri): string[] {
    return this.diagnostics.on(uri)
  }

  private folders(): FolderModel[] {
    return [...this.models.values()]
  }

  private async projectionChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      const models = this.folders()
      await Promise.all(models.map(model => model.load()))
      if (models.length > 1) return models.filter(model => model.defines || model.error).map(model => ({kind: 'folder', model}))
      return models[0] ? this.folderRows(models[0]) : []
    }
    if (node.kind === 'folder') return this.folderRows(node.model)
    if (node.kind === 'invalid') {
      return node.invalid.diagnostics.map((_, index) => ({kind: 'problem', model: node.model, invalid: node.invalid, index}))
    }
    return []
  }

  private folderRows(model: FolderModel): Node[] {
    if (model.error && !model.definitions) return [{kind: 'message', label: model.error, icon: 'error'}]
    // The repository's choice is the Choice view's control above, not a row: the rows count the changes in it.
    return [
      ...model.projections.map(definition => ({kind: 'projection', model, definition}) as Node),
      ...model.invalid.map(invalid => ({kind: 'invalid', model, invalid}) as Node),
    ]
  }

  private async suggestedChildren(node?: Node): Promise<Node[]> {
    if (node?.kind === 'folder') return this.candidateRows(node.model)
    if (node) return []
    const models = this.folders()
    await Promise.all(models.map(model => model.load()))
    const suggesting = models.filter(model => this.candidateRows(model).length)
    if (models.length > 1) return suggesting.map(model => ({kind: 'folder', model}) as Node)
    return models[0] ? this.candidateRows(models[0]) : []
  }

  /** The candidates that apply here and aren't adopted yet, by title as projections are listed. */
  private candidateRows(model: FolderModel): Node[] {
    return byTitle(
      model.candidates.filter(candidate => !candidate.adopted),
      candidate => candidate.title,
      candidate => candidate.id,
    ).map(candidate => ({kind: 'candidate', model, candidate}))
  }

  private item(node: Node): vscode.TreeItem {
    return sidebarItem(node)
  }

  /** Selects a projection's row (after New Projection… writes it), without taking focus from the editor. */
  async revealProjection(folder: vscode.WorkspaceFolder, id: string): Promise<void> {
    const model = this.model(folder)
    await model.load()
    const definition = model.definition(id)
    if (!definition) return
    this.update.flush()
    await this.projectionsView.reveal({kind: 'projection', model, definition}, {select: true, focus: false})
  }

  /** For tests: each folder's rows as the Projections view shows them. */
  rows() {
    return this.folders().map(model => ({
      folder: model.folder.name,
      loaded: Boolean(model.definitions),
      projections: model.projections.map(definition => {
        // As the view shows it: a leaf (no chevron, no part children).
        const item = this.item({kind: 'projection', model, definition})
        return {
          id: definition.id,
          title: model.title(definition.id),
          status: model.status(definition.id),
          description: typeof item.description === 'string' ? item.description : '',
          resource: item.resourceUri?.toString() ?? null,
          edited: model.edits.get(definition.id) === 'edited',
          icon: rendererIcon(definition.renderer),
          collapsible: item.collapsibleState ?? vscode.TreeItemCollapsibleState.None,
          contextValue: item.contextValue ?? null,
        }
      }),
      invalid: model.invalid.map(invalid => ({
        id: invalid.id,
        path: invalid.path,
        description: 'failed',
        messages: invalid.diagnostics.map(item => item.message),
      })),
      candidates: model.candidates.map(candidate => ({
        id: candidate.id,
        reason: candidateReason(candidate),
        adopted: candidate.adopted ?? null,
      })),
      suggested: this.candidateRows(model).map(node => (node.kind === 'candidate' ? node.candidate.id : '')),
      pair: model.pair ?? null,
      choice: {...model.choice, automatic: model.automatic, remembered: model.remembered ?? null, ...model.describe()},
      header: model.defines && model.pair ? model.describe().text : null,
      suggestions: model.pairs?.suggestions.map(pair => ({label: pair.label, before: pair.before, after: pair.after})) ?? [],
    }))
  }

  /** For tests: a row's decoration, as the FileDecorationProvider gives it. */
  decorationFor(folder: vscode.WorkspaceFolder, id: string) {
    this.update.flush()
    return this.decorations.get(rowUri(folder, id))
  }

  /** For tests: the Suggested view's rows (each folder's candidates not adopted). */
  async suggestedRows() {
    const rows = await this.suggestedChildren()
    return rows.map(node => {
      const item = this.item(node)
      return {
        kind: node.kind,
        label: typeof item.label === 'string' ? item.label : (item.label?.label ?? ''),
        description: typeof item.description === 'string' ? item.description : null,
        contextValue: item.contextValue ?? null,
      }
    })
  }

  /** The badge, for tests. */
  badge() {
    this.update.flush()
    return this.projectionsView.badge?.value ?? 0
  }

  dispose() {
    this.update.dispose()
    for (const model of this.models.values()) model.dispose()
    this.models.clear()
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }
}
