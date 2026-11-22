import type * as vscode from 'vscode'
import type {ViewingRow} from '../choices/viewing-rows.js'
import type {DevelopCell, DevelopChange} from '../develop-model.js'
import type {FolderModel} from '../folder-model.js'

export interface ViewingHost {
  request: (
    folder: vscode.WorkspaceFolder,
    request: {method: 'GET' | 'POST'; path: string; body?: unknown},
  ) => Promise<{status: number; body: unknown}>
  resolveCommits: (cwd: string, refs: string[]) => Promise<(string | undefined)[]>
  /** The open pull request of the folder's current branch, if `gh` says there is one. */
  pullRequest: (folder: vscode.WorkspaceFolder, branch: string) => Promise<number | undefined>
}

export interface Sweep {
  id: string
  status: string
  changes: DevelopChange[]
  cells: DevelopCell[]
  projections?: {status?: string}[]
}

/** A folder's run over the recent commits, its thumbnails and the rows removed from view. */
export interface Recent {
  sweep?: Sweep
  thumbnails: Map<string, string | null>
  theme?: 'light' | 'dark'
  hidden: Set<string>
}

export type Node = ViewingRow & {model: FolderModel}

/** A Viewing row as the side bar and the quick pick show it (`present`). */
export interface ViewingItem {
  /** Its id in the view: `choice:<id>`, `recent:<before>..<after>`, `pr`, `compare`, a group's name… */
  key: string
  label: string
  /** Its short fact (a choice's, possibly empty); none for a group or a status line. */
  description?: string
  /** A codicon: the check when it is the choice. */
  icon?: string
  selected: boolean
  tooltip?: string | vscode.MarkdownString
  command?: vscode.Command
  /** Its context value's words, for its inline actions. */
  context?: string[]
  accessibility: string
  /** A group: whether it starts collapsed. */
  collapsed?: boolean
}
