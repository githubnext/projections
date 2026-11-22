import * as vscode from 'vscode'
import {randomBytes} from 'node:crypto'
import type {DefinitionTarget} from '../definition.js'
import {skeletonHtml} from '../html.js'
import {parseProjectionQuery} from '../projections/resources.js'
import type {Services} from '../services.js'
import {projectionViewType} from '../decorations.js'
import {ProjectionTab} from './projection-tab.js'

/** The projection editor: a read-only custom editor on `projection:` resources, one projection per tab. */
export function projectionEditor(services: Services): vscode.CustomReadonlyEditorProvider {
  const {context, sidebar} = services
  return {
    openCustomDocument: uri => ({uri, dispose() {}}),
    async resolveCustomEditor(document, panel) {
      const parsed = parseProjectionQuery(document.uri.query)
      const folder = parsed && vscode.workspace.workspaceFolders?.find(item => item.uri.toString() === parsed.folder)
      if (!parsed || !folder) {
        panel.webview.html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><body><p>This projection's folder isn't open in this window.</p></body>`
        return
      }
      // The tab's skeleton at once, while its folder's facts load; the page (with the same skeleton) follows.
      panel.webview.options = {
        enableScripts: false,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
        enableCommandUris: false,
      }
      panel.webview.html = skeletonHtml({
        cspSource: panel.webview.cspSource,
        nonce: randomBytes(18).toString('base64url'),
        // The tab's label: the projection URI's last path segment, its title.
        title: decodeURIComponent((document.uri.path.split('/').pop() ?? '') || parsed.id),
        codicons: panel.webview
          .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'vscode-ui', 'codicons', 'codicon.css'))
          .toString(),
      })
      const firstPage = {html: panel.webview.html, at: Date.now()}
      await sidebar.model(folder).load()
      const tab = new ProjectionTab(services, folder, parsed.id, panel, firstPage)
      await tab.start()
    },
  }
}

/** The active editor tab's projection, when it is a projection tab, for the Definition view. */
export function activeDefinitionTarget(): DefinitionTarget | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab
  const input = tab?.input
  if (!(input instanceof vscode.TabInputCustom)) return undefined
  const column = tab!.group.viewColumn
  if (input.viewType === projectionViewType) {
    const parsed = parseProjectionQuery(input.uri.query)
    const tabs = [...ProjectionTab.tabs].filter(item => item.folder.uri.toString() === parsed?.folder && item.projection === parsed.id)
    return (tabs.find(item => item.panel.viewColumn === column) ?? tabs[0])?.definitionTarget()
  }
  return undefined
}

/**
 * The projection tab the person is looking at: the active editor tab when it is one (the chat keeps it the active tab
 * of its group while it has focus), else the one that was in front last; only `folder`'s, when given.
 */
export function viewedTab(folder?: vscode.WorkspaceFolder): {tab: ProjectionTab; inFront: boolean} | undefined {
  const tabs = [...ProjectionTab.tabs].filter(tab => !folder || tab.folder === folder)
  const active = vscode.window.tabGroups.activeTabGroup.activeTab
  const input = active?.input
  if (input instanceof vscode.TabInputCustom && input.viewType === projectionViewType) {
    const parsed = parseProjectionQuery(input.uri.query)
    const matching = tabs.filter(tab => tab.folder.uri.toString() === parsed?.folder && tab.projection === parsed.id)
    const tab = matching.find(item => item.panel.viewColumn === active!.group.viewColumn) ?? matching[0]
    if (tab) return {tab, inFront: true}
  }
  const last = ProjectionTab.lastActive
  if (last && tabs.includes(last)) return {tab: last, inFront: false}
  const visible = tabs.filter(tab => tab.panel.visible)
  const fallback = visible.at(-1) ?? tabs.at(-1)
  return fallback ? {tab: fallback, inFront: false} : undefined
}
