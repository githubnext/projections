import * as vscode from 'vscode'
import type {Lease} from './backends.js'
import {listPath} from './comparator-tests/wire.js'
import {parseListing, refusalMessage} from './comparator-tests/parse.js'
import {testsApi} from './testing/api.js'
import {runCases} from './testing/run-cases.js'
import {runChecks} from './testing/run-checks.js'
import {plan} from './testing/run.js'
import {TestState} from './testing/state.js'
import type {Watched} from './testing/state.js'
import {applyTree} from './testing/tree.js'

/** The projections a folder defines, by ID with their titles, and their changes (the side bar's models). */
export interface ProjectionSource {
  projections: (folder: vscode.WorkspaceFolder) => Promise<{id: string; title: string}[]>
  readonly onDidChange: vscode.Event<void>
}

const pattern = '**/*.comparator.test.{yaml,yml}'
const refreshDelayMs = 250

/**
 * Projections in VS Code's Testing view: one item per projection, whose children are its checks (`projections
 * check`'s steps, through the `check` tool) and its comparator tests, one per case at its line in the
 * `*.comparator.test.yaml` (so the gutter runs them); a test file no projection uses is an item of its own. Listing and
 * running go through the folder's shared `projections serve --stdio` backend (`GET /api/comparator-tests`, `POST
 * /api/comparator-tests/run`); the view lists again when the backend reports working tree changes. Running needs no
 * trust (comparators run sandboxed; checks run what the workspace's trust allows); the **Update snapshots** profile,
 * which writes files, exists only in a trusted workspace (the backend's `--trust`). Results are in Test Results;
 * definition problems stay in Problems.
 */
export class ProjectionTests implements vscode.Disposable {
  readonly controller: vscode.TestController
  private readonly state: TestState
  private readonly runProfile: vscode.TestRunProfile
  private updateProfile: vscode.TestRunProfile | undefined
  private readonly disposables: vscode.Disposable[] = []
  private applying: ReturnType<typeof setTimeout> | undefined
  private readonly watched: Map<string, Watched>

  private readonly lease: (folder: vscode.WorkspaceFolder) => Lease
  private readonly source: ProjectionSource
  private readonly output: vscode.LogOutputChannel

  constructor(lease: (folder: vscode.WorkspaceFolder) => Lease, source: ProjectionSource, output: vscode.LogOutputChannel) {
    this.lease = lease
    this.source = source
    this.output = output
    this.controller = vscode.tests.createTestController('projections', 'Projections')
    this.state = new TestState(this.controller)
    this.watched = this.state.watched
    this.controller.refreshHandler = () => this.scan(true)
    this.runProfile = this.controller.createRunProfile(
      'Run',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.run(request, token, false),
      true,
    )
    if (vscode.workspace.isTrusted) this.addUpdateProfile()
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
    this.disposables.push(
      this.controller,
      watcher,
      watcher.onDidCreate(uri => this.touched(uri)),
      watcher.onDidChange(uri => this.touched(uri)),
      watcher.onDidDelete(uri => this.touched(uri)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.scan(true)),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.addUpdateProfile()),
      source.onDidChange(() => {
        clearTimeout(this.applying)
        this.applying = setTimeout(() => {
          for (const watched of this.watched.values()) void this.apply(watched)
        }, refreshDelayMs)
      }),
    )
    void this.scan(false)
  }

  /** Writes snapshots: only in a trusted workspace, as the backend's `--trust` allows. */
  private addUpdateProfile() {
    this.updateProfile ??= this.controller.createRunProfile(
      'Update snapshots',
      vscode.TestRunProfileKind.Run,
      (request, token) => this.run(request, token, true),
      false,
    )
  }

  /** Watches every folder (the side bar holds its backend already) and lists its test files. */
  async scan(refresh: boolean): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? []
    for (const key of [...this.watched.keys()]) if (!folders.some(folder => folder.uri.toString() === key)) this.unwatch(key)
    await Promise.all(
      folders.map(folder => {
        const fresh = !this.watched.has(folder.uri.toString())
        this.watch(folder)
        return fresh || refresh ? this.refresh(folder) : undefined
      }),
    )
  }

  private touched(uri: vscode.Uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri)
    if (folder) this.schedule(folder)
  }

  private watch(folder: vscode.WorkspaceFolder) {
    const key = folder.uri.toString()
    if (this.watched.has(key)) return
    const watched: Watched = {folder, lease: this.lease(folder), files: [], reported: new Map()}
    this.watched.set(key, watched)
    const subscribe = (runner: {onNotification: (listener: (method: string) => void) => () => void}) => {
      watched.unsubscribe?.()
      watched.unsubscribe = runner.onNotification(method => {
        if (method === 'changes') this.schedule(folder)
      })
    }
    // A replaced backend (trust granted, or it exited) is subscribed to and listed again.
    watched.lease.onDidChange(runner => {
      subscribe(runner)
      this.schedule(folder)
    })
    void watched.lease.current().then(subscribe, () => {})
  }

  private unwatch(key: string) {
    const watched = this.watched.get(key)
    if (!watched) return
    clearTimeout(watched.timer)
    watched.unsubscribe?.()
    watched.lease.dispose()
    this.watched.delete(key)
    for (const [id, item] of this.state.items()) {
      if (this.state.data.get(item)?.folder.uri.toString() === key) this.controller.items.delete(id)
    }
  }

  private schedule(folder: vscode.WorkspaceFolder) {
    const watched = this.watched.get(folder.uri.toString())
    if (!watched) return
    clearTimeout(watched.timer)
    watched.timer = setTimeout(() => void this.refresh(folder), refreshDelayMs)
  }

  /** Lists a folder's test files again, then applies its tree. */
  async refresh(folder: vscode.WorkspaceFolder): Promise<void> {
    const watched = this.watched.get(folder.uri.toString())
    if (!watched) return
    try {
      const runner = await watched.lease.current()
      const response = await runner.request({method: 'GET', path: listPath})
      if (response.status !== 200) throw new Error(refusalMessage(response.status, response.body))
      watched.files = parseListing(response.body)
    } catch (error) {
      this.output.warn(`Projection tests in ${folder.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
    await this.apply(watched)
  }

  /** The folder's tree (`testTree`) as test items, reusing the items it had so their results stay. */
  private async apply(watched: Watched) {
    const projections = await this.source.projections(watched.folder).catch(() => [])
    applyTree(this.state, watched, projections)
  }

  /** Runs the request's checks (one `check` per projection) and comparator cases (one run per file and projection). */
  private async run(request: vscode.TestRunRequest, token: vscode.CancellationToken, update: boolean): Promise<void> {
    const run = this.controller.createTestRun(request)
    const abort = new AbortController()
    const cancelled = token.onCancellationRequested(() => abort.abort())
    try {
      const {checks, cases} = plan(this.state, request, update)
      for (const entry of [...checks, ...cases]) {
        for (const item of entry.items) {
          run.started(item)
          this.state.record(item, 'started')
        }
      }
      for (const entry of checks) {
        if (abort.signal.aborted) break
        await runChecks(this.state, run, entry, abort.signal, watched => this.apply(watched))
      }
      for (const entry of cases) {
        if (abort.signal.aborted) break
        await runCases(this.state, run, entry, update, abort.signal)
      }
      if (abort.signal.aborted) {
        for (const [key, outcome] of this.state.recorded) {
          if (outcome.state === 'started') this.state.recorded.set(key, {state: 'skipped', messages: []})
        }
      }
    } finally {
      cancelled.dispose()
      run.end()
    }
  }

  /** For tests: the items, the last outcomes, and running through a profile as the Testing view does. */
  api() {
    return testsApi(
      this.state,
      () => this.scan(true),
      () => ({run: this.runProfile, update: this.updateProfile}),
    )
  }

  dispose() {
    clearTimeout(this.applying)
    for (const key of [...this.watched.keys()]) this.unwatch(key)
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }
}
