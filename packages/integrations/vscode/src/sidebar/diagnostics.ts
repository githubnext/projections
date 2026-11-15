import * as vscode from 'vscode'
import type {FolderModel} from '../folder-model.js'

/** An invalid definition's diagnostics, at the offending field. */
function definitionDiagnostics(model: FolderModel) {
  return model.invalid.map(invalid => ({
    uri: vscode.Uri.joinPath(model.folder.uri, ...invalid.path.split('/')),
    items: invalid.diagnostics.map(diagnostic => {
      const line = Math.max(0, (diagnostic.location?.line ?? 1) - 1)
      const column = Math.max(0, (diagnostic.location?.column ?? 1) - 1)
      const item = new vscode.Diagnostic(new vscode.Range(line, column, line, column), diagnostic.message, vscode.DiagnosticSeverity.Error)
      item.source = 'projections'
      item.code = diagnostic.code
      return item
    }),
  }))
}

/** Problems: invalid definition files' diagnostics, and what the shown extractions reported on their definitions. */
export class SidebarDiagnostics implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('projections')
  /** Extraction diagnostics by folder and projection, on its definition file. */
  private readonly extraction = new Map<string, {uri: vscode.Uri; messages: string[]}>()

  constructor(private readonly models: () => Iterable<FolderModel>) {}

  /** Each invalid definition file's diagnostics in Problems, at the offending field. */
  publish() {
    this.diagnostics.clear()
    const all = new Map<string, {uri: vscode.Uri; items: vscode.Diagnostic[]}>()
    const add = (uri: vscode.Uri, items: vscode.Diagnostic[]) => {
      const entry = all.get(uri.toString()) ?? {uri, items: []}
      entry.items.push(...items)
      all.set(uri.toString(), entry)
    }
    for (const model of this.models()) for (const {uri, items} of definitionDiagnostics(model)) add(uri, items)
    // What the shown extractions reported, on the definition that produced them (Problems and squiggles).
    for (const {uri, messages} of this.extraction.values())
      add(
        uri,
        messages.map(message => {
          const item = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), message, vscode.DiagnosticSeverity.Warning)
          item.source = 'projections extraction'
          return item
        }),
      )
    for (const {uri, items} of all.values()) this.diagnostics.set(uri, items)
  }

  /** The diagnostics a tab's shown extractions report (by side), as native diagnostics on the definition file. */
  reportExtraction(folder: vscode.WorkspaceFolder, projection: string, definition: vscode.Uri | undefined, messages: string[]) {
    const key = `${folder.uri.toString()}#${projection}`
    const before = JSON.stringify(this.extraction.get(key) ?? null)
    if (definition && messages.length) this.extraction.set(key, {uri: definition, messages})
    else this.extraction.delete(key)
    if (JSON.stringify(this.extraction.get(key) ?? null) !== before) this.publish()
  }

  /** The diagnostics on a file. */
  on(uri: vscode.Uri): string[] {
    return (this.diagnostics.get(uri) ?? []).map(item => item.message)
  }

  dispose() {
    this.diagnostics.dispose()
  }
}
