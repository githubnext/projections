// The Definition view: a native tree in the Projections view container (it can be dragged elsewhere) that follows the
// active projection tab as Outline follows the active editor, or the projection it is pinned to. It is the one section
// that follows a tab. Its rows are the projection's definition (`definitionModel`, the item model Go to Source… shares):
// the definition file, Extractor, Comparator (its tests file under it), Renderer (its scenarios under it) and
// Environment. Descriptions are short facts; tooltips explain. Its title stays "Definition": the editor tab names the
// projection. While pinned, its message names the projection it is pinned to. Selecting a row never leaves VS Code: a file
// opens in an editor, a built-in part its bundled documentation in the Markdown preview (docs.ts); its page on GitHub
// is only Open Documentation on GitHub, from the row's context menu or inline action.
import * as vscode from 'vscode'
import type {Sidebar} from './sidebar.js'
import {bundledDocsUri} from './docs.js'
import {partDocs} from './projections/docs.js'
import {parts} from './projections/rows.js'
import type {DocsIndex} from './projections/docs.js'
import {follow} from './configuration-model.js'
import type {DefinitionNode} from './configuration-model.js'
import {definitionItem} from './definition/tree-item.js'
import type {BuildState} from './renderer-build-model.js'

/** A projection as a tab shows it: its folder, and the extractions shown. */
export interface DefinitionTarget {
  folder: vscode.WorkspaceFolder
  projection: string
  /** A projection tab, or no tab (a pinned view whose tab closed). */
  kind: 'tab' | 'none'
  /** The extractions shown, by ref, with which side each is. */
  documents: {side: string; ref: string; document: unknown}[]
}

export interface DefinitionHost {
  /** The active editor tab's projection, when it is a projection tab. */
  active(): DefinitionTarget | undefined
  /** An open tab of a projection, for a pinned view. */
  find(folder: vscode.WorkspaceFolder, projection: string): DefinitionTarget | undefined
  /** The projection's definition model (`projectionSources`), which Go to Source… lists too. */
  sources(folder: vscode.WorkspaceFolder, id: string): Promise<DefinitionNode[]>
  /** A custom renderer's build, as the extension runs it on save (`renderer-builds.ts`), for the Renderer row. */
  rendererBuild?(folder: vscode.WorkspaceFolder, projection: string): BuildState | undefined
  /** A tab opened, closed, became active or showed new results, or a renderer build changed. */
  readonly onDidChange: vscode.Event<void>
}

type Part = ReturnType<typeof parts>[number] & {docs?: string}

/**
 * A definition's parts with a built-in's bundled documentation page (`index` is the bundle's): what the definition
 * model and Go to Source… start from.
 */
export function sourceParts(definition: Parameters<typeof parts>[0], index: DocsIndex | undefined): Part[] {
  return parts(definition).map(part => {
    const docs = part.file ? undefined : partDocs(index, part.part, part.label)
    return {...part, ...(docs ? {docs} : {})}
  })
}

interface Node {
  node: DefinitionNode
}

const key = (target: {folder: vscode.WorkspaceFolder; projection: string}) => `${target.folder.uri.toString()}#${target.projection}`

export class DefinitionView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>()
  readonly onDidChangeTreeData = this.changed.event
  readonly view: vscode.TreeView<Node>
  private shown: DefinitionTarget | undefined
  private pinned: {folder: vscode.WorkspaceFolder; projection: string} | undefined
  /** The shown projection's definition model, for the definition it was read from. */
  private model: {key: string; nodes: DefinitionNode[]} | undefined
  private loading: Promise<void> | undefined
  private readonly disposables: vscode.Disposable[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly host: DefinitionHost,
    private readonly sidebar: Sidebar,
    private readonly output: vscode.LogOutputChannel,
  ) {
    this.view = vscode.window.createTreeView('projections.definition', {treeDataProvider: this})
    const watchers = ['**/scenarios.json', '**/*.comparator.test.{yaml,yml}', '**/environment.json'].map(glob =>
      vscode.workspace.createFileSystemWatcher(glob),
    )
    const reread = () => {
      this.model = undefined
      this.schedule()
    }
    this.disposables.push(
      this.view,
      this.changed,
      ...watchers,
      ...watchers.flatMap(watcher => [watcher.onDidCreate(reread), watcher.onDidChange(reread), watcher.onDidDelete(reread)]),
      host.onDidChange(() => this.schedule()),
      sidebar.onDidUpdate(() => this.schedule()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.schedule()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.schedule()),
      vscode.commands.registerCommand('projections.definition.pin', () => this.pin(true)),
      vscode.commands.registerCommand('projections.definition.unpin', () => this.pin(false)),
      vscode.commands.registerCommand('projections.showExtractionOutput', () => this.showExtraction()),
      vscode.commands.registerCommand('projections.configureComparator', () => {
        const shown = this.shown
        if (shown) return vscode.commands.executeCommand('projections.openPart', shown.folder.uri, shown.projection, 'comparator')
      }),
      vscode.commands.registerCommand('projections.openPartEntry', (node?: Node) => {
        const shown = this.shown
        const part = node?.node.kind
        if (shown && (part === 'extractor' || part === 'comparator' || part === 'renderer')) {
          return vscode.commands.executeCommand('projections.openPart', shown.folder.uri, shown.projection, part)
        }
      }),
    )
    void vscode.commands.executeCommand('setContext', 'projections.definitionPinned', false)
    this.update()
  }

  /** The projection the view shows (the active tab's, or the pinned one). */
  current(): {folder: vscode.WorkspaceFolder; projection: string} | undefined {
    clearTimeout(this.timer)
    this.update()
    return (
      this.shown && {
        folder: this.shown.folder,
        projection: this.shown.projection,
      }
    )
  }

  /** Updates soon: tab and editor changes come in bursts. */
  private schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.update(), 50)
  }

  /**
   * What to show: the pinned projection, the active tab's, or the one shown while one of its own files (or a built-in
   * part's documentation, in the Markdown preview) is active.
   */
  private update() {
    const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input
    const editor = active instanceof vscode.TabInputText || active instanceof vscode.TabInputCustom ? active.uri.toString() : undefined
    const tab = this.host.active()
    const pinned =
      this.pinned && (this.host.find(this.pinned.folder, this.pinned.projection) ?? {...this.pinned, kind: 'none' as const, documents: []})
    const asKey = (target: DefinitionTarget | undefined) => (target ? {...target, folder: target.folder.uri.toString()} : undefined)
    const chosen = follow({
      pinned: asKey(pinned),
      tab: asKey(tab),
      shown: asKey(this.shown),
      editor,
      files: this.ownFiles().map(uri => uri.toString()),
    })
    this.shown = chosen
      ? [pinned, tab, this.shown].find(
          item => item && item.folder.uri.toString() === chosen.folder && item.projection === chosen.projection,
        )
      : undefined
    const shown = this.shown
    // The pin is the one state the tab doesn't show: name what it holds.
    const message = this.pinned && shown ? `Pinned to ${this.sidebar.model(shown.folder).title(shown.projection)}` : ''
    if ((this.view.message ?? '') !== message) this.view.message = message
    void vscode.commands.executeCommand('setContext', 'projections.definitionShown', Boolean(shown))
    void this.load().then(() => this.changed.fire(undefined))
  }

  /** The model's key: the projection and the definition it reads, so an edit reads it again. */
  private modelKey(): string | undefined {
    const shown = this.shown
    if (!shown) return undefined
    return `${key(shown)}#${JSON.stringify(this.sidebar.model(shown.folder).definition(shown.projection) ?? null)}`
  }

  /** Reads the shown projection's definition model, once per projection and definition. */
  private load(): Promise<void> {
    const shown = this.shown
    const wanted = this.modelKey()
    if (!shown || !wanted || this.model?.key === wanted) return this.loading ?? Promise.resolve()
    this.loading = this.host.sources(shown.folder, shown.projection).then(
      nodes => {
        if (this.modelKey() === wanted) this.model = {key: wanted, nodes}
      },
      (error: unknown) => this.output.warn(`Definition of ${shown.projection}: ${error instanceof Error ? error.message : String(error)}`),
    )
    return this.loading
  }

  /** The shown projection's own files and its built-ins' docs: opening one keeps the view on it, as Outline keeps its file. */
  private ownFiles(): vscode.Uri[] {
    const shown = this.shown
    if (!shown || !this.model?.key.startsWith(`${key(shown)}#`)) return []
    const files = (nodes: readonly DefinitionNode[]): vscode.Uri[] =>
      nodes.flatMap(node => [
        ...(node.file ? [vscode.Uri.joinPath(shown.folder.uri, ...node.file.split('/'))] : []),
        ...(node.docs ? [bundledDocsUri(node.docs)].filter(uri => uri !== undefined) : []),
        ...files(node.children),
      ])
    return files(this.model.nodes)
  }

  private pin(on: boolean) {
    this.pinned = on && this.shown ? {folder: this.shown.folder, projection: this.shown.projection} : undefined
    void vscode.commands.executeCommand('setContext', 'projections.definitionPinned', Boolean(this.pinned))
    this.update()
  }

  /** The extractions the tab shows, in the Projections output channel. */
  private showExtraction() {
    const shown = this.shown
    if (!shown) return
    if (!shown.documents.length) {
      this.output.info(`${shown.projection}: nothing extracted yet${shown.kind === 'none' ? ': open its tab to extract it' : ''}.`)
    }
    for (const item of shown.documents) {
      const text = JSON.stringify(item.document, null, 2)
      this.output.info(
        `${shown.projection} extraction, ${item.side} (${item.ref}):\n${text.length > 500_000 ? `${text.slice(0, 500_000)}\n…` : text}`,
      )
    }
    this.output.show(true)
  }

  /** For tests: the title, the pin's message and the rows as the view shows them, with their children. */
  async rows(): Promise<{
    projection: string | null
    pinned: boolean
    title: string | null
    message: string | null
    rows: unknown[]
  }> {
    clearTimeout(this.timer)
    this.update()
    await this.load()
    const describe = (node: Node): unknown => {
      const item = this.getTreeItem(node)
      return {
        kind: node.node.kind,
        label: typeof item.label === 'string' ? item.label : item.label?.label,
        description: item.description ?? null,
        contextValue: item.contextValue ?? null,
        tooltip: item.tooltip instanceof vscode.MarkdownString ? item.tooltip.value : (item.tooltip ?? null),
        command: item.command
          ? {
              command: item.command.command,
              arguments: item.command.arguments?.map(String),
            }
          : null,
        children: this.getChildren(node).map(describe),
      }
    }
    return {
      projection: this.shown?.projection ?? null,
      pinned: Boolean(this.pinned),
      title: this.view.title ?? null,
      message: this.view.message || null,
      rows: this.getChildren().map(describe),
    }
  }

  /** Runs a row's command, as a click does. For tests. */
  async activate(kind: DefinitionNode['kind'], label?: string) {
    await this.load()
    const all = (nodes: readonly Node[]): Node[] => nodes.flatMap(node => [node, ...all(this.getChildren(node))])
    const node = all(this.getChildren()).find(item => item.node.kind === kind && (!label || item.node.label === label))
    const command = node && this.getTreeItem(node).command
    if (!command) throw new Error(`No ${kind} row to activate`)
    const args: unknown[] = command.arguments ?? []
    await vscode.commands.executeCommand(command.command, ...args)
  }

  getChildren(node?: Node): Node[] {
    if (!this.shown || !this.model?.key.startsWith(`${key(this.shown)}#`)) return []
    return (node ? node.node.children : this.model.nodes).map(child => ({node: child}))
  }

  getTreeItem({node}: Node): vscode.TreeItem {
    const shown = this.shown!
    const context = {
      folder: shown.folder,
      projection: shown.projection,
      definition: this.sidebar.model(shown.folder).definition(shown.projection),
      build: node.kind === 'renderer' ? this.host.rendererBuild?.(shown.folder, shown.projection) : undefined,
    }
    return definitionItem(node, context, `${key(shown)}#${node.kind}:${node.file ?? node.label}`)
  }

  dispose() {
    clearTimeout(this.timer)
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }
}
