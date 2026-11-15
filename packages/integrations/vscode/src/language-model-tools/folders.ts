import * as vscode from 'vscode'
import {viewedTab} from '../panels/projection-editor.js'

/** The workspace folder a tool acts on: the one it names, else the active editor's or projection tab's, else the first. */
export function toolFolder(name: unknown): vscode.WorkspaceFolder {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (!folders[0]) throw new Error('Open a repository folder first: Projections works on a workspace folder')
  if (typeof name === 'string' && name) {
    const found = folders.find(folder => folder.name === name || folder.uri.fsPath === name || folder.uri.toString() === name)
    if (!found) throw new Error(`No open workspace folder ${name}; the open ones are ${folders.map(folder => folder.name).join(', ')}`)
    return found
  }
  const editor = vscode.window.activeTextEditor
  return (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri)) ?? viewedTab()?.tab.folder ?? folders[0]
}

/** The folder a view tool names, when it names one and a folder is open; otherwise any folder's tab will do. */
export function namedFolder(name: unknown): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders ?? []
  return typeof name === 'string' && name && folders.length ? toolFolder(name) : undefined
}

/** An abort signal that follows a cancellation token. */
export function abortOn(token: vscode.CancellationToken | undefined): AbortSignal | undefined {
  if (!token) return undefined
  const controller = new AbortController()
  if (token.isCancellationRequested) controller.abort()
  else token.onCancellationRequested(() => controller.abort())
  return controller.signal
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
