import * as vscode from 'vscode'
import type {Choice} from './choices/model.js'
import {ProjectionTab} from './panels/projection-tab.js'
import {refLabel} from './projections/pairs.js'
import {listPullRequests, pullRequestPair, type PullRequest} from './pulls.js'
import type {Services} from './services.js'
import type {Sidebar} from './sidebar.js'

/** The quick picks the extension shows, which tests wait for and answer. */
export class QuickPicks {
  /** Quick picks shown and not yet closed, for tests that answer them (see `show`). */
  open = 0
  /** The quick pick `show` shows, for tests that read and answer it. */
  shown: vscode.QuickPick<vscode.QuickPickItem> | undefined

  /**
   * `showQuickPick`, as a quick pick the extension knows is shown: tests wait for it rather than for a fixed time before
   * answering it with the workbench's quick open commands.
   */
  readonly show = <Item extends vscode.QuickPickItem>(
    items: readonly Item[],
    options: {title?: string; placeHolder?: string; matchOnDescription?: boolean; active?: Item | undefined},
  ): Promise<Item | undefined> => {
    const pick = vscode.window.createQuickPick<Item>()
    pick.items = items
    if (options.active) pick.activeItems = [options.active]
    if (options.title) pick.title = options.title
    if (options.placeHolder) pick.placeholder = options.placeHolder
    pick.matchOnDescription = options.matchOnDescription ?? false
    return new Promise(resolve => {
      let chosen: Item | undefined
      pick.onDidAccept(() => {
        chosen = pick.selectedItems[0] ?? pick.activeItems[0]
        pick.hide()
      })
      pick.onDidHide(() => {
        this.open--
        if (this.shown === pick) this.shown = undefined
        pick.dispose()
        resolve(chosen)
      })
      pick.show()
      this.open++
      this.shown = pick
    })
  }
}

export async function chooseFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length <= 1) {
    if (!folders[0]) void vscode.window.showWarningMessage('Projections: open a repository folder first')
    return folders[0]
  }
  const active = vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
  return active ?? (await vscode.window.showWorkspaceFolderPick({placeHolder: 'Repository to inspect'}))
}

/** The folder a command acts on: one it was given (a URI or a side bar row), the projection tab in front, or chosen. */
export async function folderFrom(argument: unknown): Promise<vscode.WorkspaceFolder | undefined> {
  if (argument instanceof vscode.Uri) return vscode.workspace.getWorkspaceFolder(argument)
  const model = (argument as {model?: {folder?: vscode.WorkspaceFolder}} | undefined)?.model
  if (model?.folder) return model.folder
  return ProjectionTab.current?.folder ?? (await chooseFolder())
}

/** A revision to choose in Change…: the working tree, branches, tags and recent commits. */
export async function chooseRevision(
  services: Services,
  folder: vscode.WorkspaceFolder,
  title: string,
  placeholder: string,
): Promise<string | undefined> {
  const model = services.sidebar.model(folder)
  const revisions = await services.withBackend(folder, async runner => {
    const response = await runner.request({method: 'GET', path: '/api/revisions?limit=30'})
    return response.status === 200
      ? ((response.body as {revisions?: {ref?: string; title?: string; kind?: string; date?: string}[]}).revisions ?? [])
      : []
  })
  type Item = vscode.QuickPickItem & {ref?: string}
  const items: Item[] = [
    {label: '$(edit) Working tree', ref: 'working-tree', description: 'uncommitted changes included'},
    {label: 'Branches', kind: vscode.QuickPickItemKind.Separator},
    ...(model.pairs?.branches ?? []).map(name => ({label: `$(git-branch) ${name}`, ref: name})),
    {label: 'Tags', kind: vscode.QuickPickItemKind.Separator},
    ...(model.pairs?.tags ?? []).map(name => ({label: `$(tag) ${name}`, ref: name})),
    {label: 'Recent commits', kind: vscode.QuickPickItemKind.Separator},
    ...revisions
      .filter(item => item.kind === 'commit' && item.ref)
      .map(item => ({
        label: `$(git-commit) ${refLabel(item.ref!)}`,
        description: item.title ?? '',
        detail: item.date ?? '',
        ref: item.ref!,
      })),
  ]
  const chosen = await vscode.window.showQuickPick(items, {title, placeHolder: placeholder, matchOnDescription: true})
  return chosen?.ref
}

/** Pull request…: the open pull requests (this branch's first), then the chosen one's pair, fetched if need be. */
export async function pickPullRequest(sidebar: Sidebar, folder: vscode.WorkspaceFolder): Promise<Choice | undefined> {
  const cwd = folder.uri.fsPath
  const branch = sidebar.model(folder).pairs?.head?.branch
  type Item = vscode.QuickPickItem & {pull?: PullRequest}
  const pick = vscode.window.createQuickPick<Item>()
  pick.title = 'Pull request'
  pick.placeholder = 'Open pull requests, compared locally from their merge base to their head'
  pick.matchOnDescription = true
  pick.busy = true
  const entry = (pull: PullRequest): Item => ({
    label: `$(git-pull-request${pull.isDraft ? '-draft' : ''}) #${pull.number} ${pull.title}`,
    description: `${pull.headRefName} → ${pull.baseRefName}${pull.author ? ` · ${pull.author}` : ''}`,
    pull,
  })
  void listPullRequests(cwd).then(
    pulls => {
      const mine = pulls.filter(pull => branch && pull.headRefName === branch)
      const others = pulls.filter(pull => !mine.includes(pull))
      pick.items = pulls.length
        ? [
            ...(mine.length ? [{label: 'This branch', kind: vscode.QuickPickItemKind.Separator}, ...mine.map(entry)] : []),
            ...(others.length ? [{label: 'Open pull requests', kind: vscode.QuickPickItemKind.Separator}, ...others.map(entry)] : []),
          ]
        : [{label: 'No open pull requests'}]
      pick.busy = false
    },
    (error: unknown) => {
      pick.items = [{label: `$(error) ${error instanceof Error ? error.message : String(error)}`}]
      pick.busy = false
    },
  )
  pick.show()
  const chosen = await new Promise<Item | undefined>(resolve => {
    pick.onDidAccept(() => resolve(pick.selectedItems[0]))
    pick.onDidHide(() => resolve(undefined))
  })
  pick.dispose()
  const pull = chosen?.pull
  if (!pull) return undefined
  const pair = await vscode.window.withProgress(
    {location: vscode.ProgressLocation.Notification, title: `Projections: fetching pull request #${pull.number}`},
    () => pullRequestPair(cwd, pull),
  )
  return {id: `pr:${pull.number}`, pair, title: `#${pull.number} ${pull.title}`}
}
