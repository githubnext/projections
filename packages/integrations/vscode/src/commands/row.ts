import * as vscode from 'vscode'
import {ProjectionTab} from '../panels/projection-tab.js'
import type {Sidebar} from '../sidebar.js'

/** A Projections row's folder and projection, or the projection tab in front's. */
export function rowTarget(node: unknown): {folder: vscode.WorkspaceFolder; id: string} | undefined {
  const row = node as {model?: {folder?: vscode.WorkspaceFolder}; definition?: {id?: string}} | undefined
  if (row?.model?.folder && typeof row.definition?.id === 'string') return {folder: row.model.folder, id: row.definition.id}
  const tab = ProjectionTab.current
  return tab ? {folder: tab.folder, id: tab.projection} : undefined
}

/** A Projections row's inline action: Refresh. */
export function rowCommands(sidebar: Sidebar): vscode.Disposable[] {
  return [
    // Re-extracts the projection's open tabs, or counts its changes again when none is open.
    vscode.commands.registerCommand('projections.refreshProjection', async (node?: unknown) => {
      const target = rowTarget(node)
      if (!target) return
      const model = sidebar.model(target.folder)
      const tabs = [...ProjectionTab.tabs].filter(tab => tab.folder === target.folder && tab.projection === target.id)
      if (tabs.length) {
        for (const tab of tabs) await tab.refresh()
        return
      }
      if (!model.pair?.before) return model.refresh()
      await vscode.window.withProgress(
        {location: {viewId: 'projections.projections'}, title: `Comparing ${target.id}`, cancellable: true},
        (progress, token) => model.compareAll(progress, token, target.id),
      )
    }),
  ]
}
