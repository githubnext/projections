import * as vscode from 'vscode'
import {recentChanges} from '../choices/recent.js'
import type {RecentState} from '../choices/viewing-rows.js'
import {sweepProgress} from '../develop-model.js'
import type {FolderModel} from '../folder-model.js'
import type {Recent, Sweep, ViewingHost} from './types.js'

const themeOf = (): 'light' | 'dark' => {
  const kind = vscode.window.activeColorTheme.kind
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast ? 'dark' : 'light'
}

const idle = (status: string): Sweep => ({id: '', status, changes: [], cells: []})

/** Each folder's run over the recent commits (`/api/sweep`), the thumbnails of what they change and those hidden. */
export class RecentCommits {
  private readonly recent = new Map<string, Recent>()
  /** For tests: how many times recent commits were checked. */
  finds = 0

  private readonly host: ViewingHost
  private readonly changed: () => void

  constructor(host: ViewingHost, changed: () => void) {
    this.host = host
    this.changed = changed
  }

  state(model: FolderModel): Recent {
    const key = model.folder.uri.toString()
    let recent = this.recent.get(key)
    if (!recent) {
      recent = {thumbnails: new Map(), hidden: new Set()}
      this.recent.set(key, recent)
    }
    return recent
  }

  /** The folders' runs, by folder URI, for drawing their thumbnails again. */
  entries() {
    return this.recent.entries()
  }

  recentState(model: FolderModel): RecentState {
    const recent = this.state(model)
    const sweep = recent.sweep
    const ready = sweep?.projections?.filter(row => row.status === 'ready').length ?? model.projections.length
    return {
      status: !sweep
        ? 'none'
        : sweep.status === 'running'
          ? 'running'
          : sweep.status === 'failed' || sweep.status === 'cancelled'
            ? sweep.status
            : 'done',
      changes: sweep
        ? recentChanges({
            changes: sweep.changes,
            cells: sweep.cells,
            title: id => model.title(id),
            hidden: recent.hidden,
          })
        : [],
      progress: sweepProgress(sweep, ready),
    }
  }

  /** Find Recent Changes: the last commits, each checked with every projection, then thumbnails of those that change one. */
  async find(model: FolderModel, reveal = true) {
    await model.load()
    const recent = this.state(model)
    if (recent.sweep?.status === 'running') return
    const projections = model.projections.map(definition => definition.id)
    if (!projections.length) return
    // Marked running at once, so expanding the group again doesn't start another.
    recent.sweep = idle('running')
    this.changed()
    if (reveal) await vscode.commands.executeCommand('projections.viewing.focus')
    const started = await this.host
      .request(model.folder, {method: 'POST', path: '/api/sweep', body: {projections: projections.slice(0, 50), last: 10}})
      .catch((error: unknown) => ({status: 0, body: {error: error instanceof Error ? error.message : String(error)}}))
    if (started.status !== 202) {
      recent.sweep = idle('failed')
      this.changed()
      throw new Error(`Checking recent commits didn't start (${started.status}): ${JSON.stringify(started.body).slice(0, 300)}`)
    }
    this.finds++
    const id = String((started.body as {id?: unknown}).id)
    recent.sweep = {id, status: 'running', changes: [], cells: []}
    recent.thumbnails.clear()
    recent.hidden.clear()
    this.changed()
    await this.follow(model, recent, id)
    if (recent.sweep.id === id && recent.sweep.status === 'running') recent.sweep = {...recent.sweep, status: 'cancelled'}
    this.changed()
    await this.renderThumbnails(model, recent)
  }

  /** Follows the run until it ends (or the person cancels it), with the view's progress. */
  private follow(model: FolderModel, recent: Recent, id: string) {
    return vscode.window.withProgress(
      {
        location: {viewId: 'projections.viewing'},
        title: 'Checking recent commits',
        cancellable: true,
      },
      async (_progress, token) => {
        const cancel = token.onCancellationRequested(
          () => void this.host.request(model.folder, {method: 'POST', path: '/api/sweep', body: {cancel: true}}).catch(() => {}),
        )
        try {
          for (;;) {
            const response = await this.host.request(model.folder, {method: 'GET', path: '/api/sweep'})
            const sweep = (response.body as {sweep?: Sweep | null} | null)?.sweep
            if (sweep?.id !== id) break
            recent.sweep = sweep
            this.changed()
            if (sweep.status !== 'running') break
            await new Promise(resolve => setTimeout(resolve, 500))
          }
        } finally {
          cancel.dispose()
        }
      },
    )
  }

  /** Each recent commit's thumbnail of the first projection it changes, in VS Code's colour mode, one at a time. */
  async renderThumbnails(model: FolderModel, recent: Recent) {
    const theme = themeOf()
    if (recent.theme !== theme) recent.thumbnails.clear()
    recent.theme = theme
    const id = recent.sweep?.id
    for (const change of this.recentState(model).changes) {
      if (recent.thumbnails.has(change.key)) continue
      const query = new URLSearchParams({projection: change.projections[0]!.id, before: change.before, after: change.after, theme})
      const response = await this.host
        .request(model.folder, {
          method: 'GET',
          path: `/api/sweep/thumbnail?${query}`,
        })
        .catch(() => undefined)
      if (recent.sweep?.id !== id || recent.theme !== theme) return
      const base64 = (response?.body as {base64?: unknown} | null)?.base64
      recent.thumbnails.set(change.key, response?.status === 200 && typeof base64 === 'string' ? `data:image/png;base64,${base64}` : null)
      this.changed()
    }
  }
}
