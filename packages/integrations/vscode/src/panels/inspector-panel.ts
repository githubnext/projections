import * as vscode from 'vscode'
import {basename} from 'node:path'
import {sourceKey} from '../backend-sources.js'
import type {PanelSource} from '../backend-sources.js'
import type {Services} from '../services.js'
import {InspectorWebview} from './inspector-webview.js'

/** One repository's (or document's, or scenarios') Inspector: its webview panel, on the source's shared backend. */
export class InspectorPanel extends InspectorWebview {
  private static readonly panels = new Map<string, InspectorPanel>()

  static async show(services: Services, source: PanelSource, view: 'explore' | 'inspect' = 'inspect') {
    const key = sourceKey(source)
    let panel = InspectorPanel.panels.get(key)
    if (panel) {
      panel.panel.reveal()
      if (panel.view !== view) panel.show(view)
      return panel
    }
    const title =
      source.kind === 'repository'
        ? `Projections · ${source.folder.name}`
        : source.kind === 'document'
          ? `Projections · ${basename(source.file.fsPath)}`
          : `Projections scenarios · ${basename(source.directory.fsPath)}`
    const webview = vscode.window.createWebviewPanel('projections.inspector', title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      // Only the extension's built files; no repository files, no network.
      localResourceRoots: [vscode.Uri.joinPath(services.context.extensionUri, 'dist')],
      enableCommandUris: false,
    })
    webview.iconPath = vscode.Uri.joinPath(services.context.extensionUri, 'media', 'icon.svg')
    panel = new InspectorPanel(services, source, webview, view)
    InspectorPanel.panels.set(key, panel)
    await panel.start()
    return panel
  }

  /** The folder's open panel, on either view. */
  static find(folder: vscode.WorkspaceFolder): InspectorPanel | undefined {
    return InspectorPanel.panels.get(folder.uri.toString())
  }

  /** The most recently opened panel of a kind, for tests driving a document or scenarios panel. */
  static latest(kind: PanelSource['kind']): InspectorPanel | undefined {
    return [...InspectorPanel.panels.values()].findLast(panel => panel.source.kind === kind)
  }

  static disposeAll() {
    for (const panel of InspectorPanel.panels.values()) panel.panel.dispose()
  }

  /** Reloads the page of a panel open on the Explore view, after an adoption changed what it shows. */
  static refreshExplore(folder: vscode.WorkspaceFolder) {
    const panel = InspectorPanel.panels.get(folder.uri.toString())
    if (panel?.view === 'explore') panel.show('explore')
  }

  protected override dispose() {
    InspectorPanel.panels.delete(sourceKey(this.source))
    super.dispose()
  }
}
