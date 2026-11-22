import * as vscode from 'vscode'
import {projectionPath, projectionQuery} from './projections/resources.js'
import {rowPath, rowScheme, type RowStatus} from './row-status.js'

export const projectionScheme = 'projection'
export const projectionViewType = 'projections.projection'

/** A `projection:` resource for a folder's projection, which opens in the projection editor. */
export function projectionUri(folder: vscode.WorkspaceFolder, id: string, title: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: projectionScheme,
    path: projectionPath(folder.name, title),
    query: projectionQuery(folder.uri.toString(), id),
  })
}

/**
 * The Projections rows' decorations: each row's resource (`projections-row:/<folder>/<id>`) gets its change count as a
 * badge in the modified resource color, or a muted label before it is compared (`rowStatus`), as a changed file's row
 * gets its Git decoration.
 */
export class RowDecorations implements vscode.FileDecorationProvider {
  private readonly decorations = new Map<string, vscode.FileDecoration>()
  private readonly emitter = new vscode.EventEmitter<vscode.Uri[]>()
  readonly onDidChangeFileDecorations = this.emitter.event

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    return uri.scheme === rowScheme ? this.decorations.get(uri.toString()) : undefined
  }

  /** Sets every row's decoration; rows whose decoration changed are told. */
  set(rows: readonly {uri: vscode.Uri; status: RowStatus}[]) {
    const next = new Map<string, vscode.FileDecoration>()
    for (const {uri, status} of rows) {
      if (!status.badge && !status.color) continue
      const decoration = new vscode.FileDecoration(
        status.badge,
        status.tooltip,
        status.color ? new vscode.ThemeColor(status.color) : undefined,
      )
      next.set(uri.toString(), decoration)
    }
    const changed = [...new Set([...this.decorations.keys(), ...next.keys()])].filter(key => {
      const a = this.decorations.get(key)
      const b = next.get(key)
      return (
        a?.badge !== b?.badge ||
        a?.tooltip !== b?.tooltip ||
        (a?.color as {id?: string} | undefined)?.id !== (b?.color as {id?: string} | undefined)?.id
      )
    })
    this.decorations.clear()
    for (const [key, value] of next) this.decorations.set(key, value)
    if (changed.length) this.emitter.fire(changed.map(key => vscode.Uri.parse(key)))
  }

  /** For tests: a row's badge and color. */
  get(uri: vscode.Uri): {badge: string | null; color: string | null; tooltip: string | null} {
    const decoration = this.decorations.get(uri.toString())
    return {
      badge: decoration?.badge ?? null,
      color: (decoration?.color as {id?: string} | undefined)?.id ?? null,
      tooltip: decoration?.tooltip ?? null,
    }
  }

  dispose() {
    this.emitter.dispose()
  }
}

/** A row's resource, which carries its decoration. */
export function rowUri(folder: vscode.WorkspaceFolder, id: string): vscode.Uri {
  return vscode.Uri.from({scheme: rowScheme, path: rowPath(folder.uri.toString(), id)})
}
