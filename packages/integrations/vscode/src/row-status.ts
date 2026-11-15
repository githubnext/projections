/*
 * How a Projections row shows its status, without VS Code: a change count as a right-edge badge in the modified
 * resource color (as a changed file's), a muted label when it hasn't been compared, a short description only for what
 * is unusual (out of date, needs trust, failed, working) and the full status in its tooltip. The extension applies it
 * with a FileDecorationProvider on the row's `projections-row:` resource. Nothing here imports VS Code.
 */

/** The custom scheme of the rows' resources, which only the rows' decorations use. */
export const rowScheme = 'projections-row'

/** Theme color IDs the decorations use. */
export const rowColors = {
  changed: 'gitDecoration.modifiedResourceForeground',
  muted: 'disabledForeground',
  failed: 'list.errorForeground',
} as const

export interface RowStatus {
  /** The badge (at most two characters: `3`, `9+`), only when it changed. */
  badge?: string
  /** A theme color ID for the label (and badge). */
  color?: string
  /** The row's description: a short fact, or nothing. */
  description?: string
  /** The full status, for its tooltip and the badge's. */
  tooltip: string
}

/** A count as a badge: at most two characters. */
export function badgeText(count: number): string {
  return count > 9 ? '9+' : String(Math.max(0, Math.floor(count)))
}

/**
 * A row's status (`FolderModel.status`: `3 changes`, `no change`, `not compared`, `Out of date`, …) as its badge,
 * color, description and tooltip, on the folder's choice (`Uncommitted changes`).
 */
export function rowStatus(status: string, choice?: string): RowStatus {
  const on = choice ? ` (${choice})` : ''
  const count = /^(\d+) changes?$/.exec(status)
  if (count) {
    const changes = Number(count[1])
    return {
      badge: badgeText(changes),
      color: rowColors.changed,
      tooltip: `${status}${on}`,
    }
  }
  switch (status) {
    case 'no change':
      return {tooltip: `No changes${on}`}
    case 'not compared':
      return {color: rowColors.muted, tooltip: `Not compared yet${on}`}
    case 'not extracted':
      return {color: rowColors.muted, tooltip: `Not extracted yet${on}`}
    case 'extracted':
      return {tooltip: `Extracted${on}`}
    case 'Out of date':
      return {description: 'Out of date', tooltip: 'Out of date: its result was taken before a change. Refresh to update it.'}
    case 'needs trust':
      return {description: 'needs trust', tooltip: 'Runs repository code: trust the workspace to compare it.'}
    case 'failed':
      return {description: 'failed', color: rowColors.failed, tooltip: 'It failed: open it to see why.'}
    default:
      return {
        description: status,
        tooltip: `${status[0]?.toUpperCase() ?? ''}${status.slice(1)}${on}`,
      }
  }
}

/** A row's description: its status's, then `edited` when its definition has uncommitted edits. */
export function rowDescription(status: RowStatus, edited: boolean): string {
  return [status.description, edited ? 'edited' : undefined].filter(Boolean).join(' · ')
}

/** The `projections-row:` path of a folder's projection: `/<folder URI, encoded>/<id, encoded>`. */
export function rowPath(folder: string, id: string): string {
  return `/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`
}
