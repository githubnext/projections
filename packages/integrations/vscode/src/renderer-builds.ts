// Custom renderer builds without a separate watch process. The folder's backend (the CLI service, as `projections
// view` uses it too) runs them: when a custom renderer's source is saved in a trusted workspace while a tab of its
// projection is open, the extension tells the backend (`POST /api/renderer-builds`), which starts the renderer
// package's `watch` script (else runs its `build`) and reports its state and output (`rendererBuilds`
// notifications). Each run shows in a background task's terminal, its errors in Problems through the
// `$projections-renderer` problem matcher. The backend sees the rebuilt bundle (`renderer:<id>`) and tabs reload the
// renderer, as for any renderer change. A watcher stops when no tab of its projection is open. In an untrusted
// workspace nothing runs (the backend runs without --trust): the Definition view's Renderer row says it needs trust,
// and a notification offers to trust it. The state of each build (building, built or failed) is the Renderer row's
// (`buildRow`). The logic is in renderer-build-model.ts and packages/cli/src/renderer_builds/.
import * as vscode from 'vscode'
import type {Lease} from './backends.js'
import type {ProjectionDefinition} from './projections/definitions.js'
import type {Runner} from './runner.js'
import {isRendererSource, rendererPackage, type BuildPhase, type BuildState} from './renderer-build-model.js'
import {RelayTerminal} from './renderer-builds/relay-terminal.js'
import {noop} from './noop.ts'

export const rendererTaskType = 'projections-renderer'

export interface RendererBuildHost {
  /** The folder's valid projections, as the side bar read them. */
  projections: (folder: vscode.WorkspaceFolder) => readonly ProjectionDefinition[]
  /** Whether a tab of the projection is open. */
  hasTab: (folder: vscode.WorkspaceFolder, projection: string) => boolean
  /** Tabs opened or closed. */
  readonly onDidChangeTabs: vscode.Event<void>
  /** The folder's shared backend, which runs the builds. */
  lease: (folder: vscode.WorkspaceFolder) => Lease
}

/** One build as the backend reports it (`GET /api/renderer-builds`, `rendererBuilds` notifications). */
interface Reported {
  projection: string
  phase: BuildPhase
  error?: string | null
  script?: string | null
  package?: string | null
  located?: boolean
  run: number
  running: boolean
  exit?: number | null
  lines?: string[]
}

interface Build {
  state: BuildState
  run: number
  running: boolean
  terminal?: RelayTerminal | undefined
  execution?: Thenable<vscode.TaskExecution> | undefined
}

interface Folder {
  folder: vscode.WorkspaceFolder
  lease: Lease
  builds: Map<string, Build>
  stop: () => void
}

const stateOf = (reported: Reported): BuildState => ({
  phase: reported.phase,
  ...(reported.error ? {error: reported.error} : {}),
  ...(reported.script ? {script: reported.script} : {}),
  ...(reported.package ? {package: reported.package} : {}),
  ...(reported.located ? {located: true} : {}),
})

export class RendererBuilds implements vscode.Disposable {
  private readonly folders = new Map<string, Folder>()
  private readonly asked = new Set<string>()
  private readonly changed = new vscode.EventEmitter<void>()
  /** A build's state changed (the Definition view's Renderer row). */
  readonly onDidChange = this.changed.event
  private readonly disposables: vscode.Disposable[] = []

  private readonly host: RendererBuildHost
  private readonly output: vscode.LogOutputChannel

  constructor(host: RendererBuildHost, output: vscode.LogOutputChannel) {
    this.host = host
    this.output = output
    this.disposables.push(
      this.changed,
      vscode.workspace.onDidSaveTextDocument(document => void this.saved(document.uri)),
      host.onDidChangeTabs(() => this.tabsChanged()),
    )
  }

  /** A renderer build's state, for the Definition view's Renderer row. */
  state(folder: vscode.WorkspaceFolder, projection: string): BuildState | undefined {
    return this.folders.get(folder.uri.toString())?.builds.get(projection)?.state
  }

  /** For tests: every build's projection, state and whether its script runs. */
  list(): {projection: string; state: BuildState; running: boolean}[] {
    return [...this.folders.values()].flatMap(entry =>
      [...entry.builds].map(([projection, build]) => ({projection, state: build.state, running: build.running})),
    )
  }

  /** The folder's backend, held and listened to while it has builds. */
  private folder(folder: vscode.WorkspaceFolder): Folder {
    const key = folder.uri.toString()
    const known = this.folders.get(key)
    if (known) return known
    const lease = this.host.lease(folder)
    let unsubscribe: (() => void) | undefined
    const entry: Folder = {folder, lease, builds: new Map(), stop: noop}
    const subscribe = (runner: Runner) => {
      unsubscribe?.()
      unsubscribe = runner.onNotification((method, params) => {
        if (method === 'rendererBuilds') this.apply(entry, params)
      })
    }
    void lease.current().then(subscribe, noop)
    // A replaced backend (trust granted, or it exited) starts with no builds: each open tab's renderer is asked for
    // again, and one saved while the workspace wasn't trusted builds now.
    const stopListening = lease.onDidChange(runner => {
      subscribe(runner)
      const waiting = [...entry.builds].filter(([, build]) => build.state.phase === 'untrusted').map(([projection]) => projection)
      for (const build of entry.builds.values()) build.terminal?.end(null)
      entry.builds.clear()
      this.changed.fire()
      for (const definition of this.host.projections(folder)) {
        if (this.host.hasTab(folder, definition.id) && rendererPackage(definition)) {
          void this.send(folder, definition.id, waiting.includes(definition.id) ? 'saved' : 'opened')
        }
      }
    })
    entry.stop = () => {
      unsubscribe?.()
      stopListening()
      lease.dispose()
    }
    this.folders.set(key, entry)
    return entry
  }

  /** Tells the backend about a projection's renderer: `opened`, `saved` or `closed`. */
  private async send(folder: vscode.WorkspaceFolder, projection: string, event: 'opened' | 'saved' | 'closed') {
    const entry = this.folder(folder)
    try {
      const runner = await entry.lease.current()
      const response = await runner.request({method: 'POST', path: '/api/renderer-builds', body: {projection, event}})
      if (response.status === 200) this.apply(entry, response.body)
      else this.output.warn(`${projection}: the backend refused the renderer build (${response.status})`)
    } catch (error) {
      this.output.warn(`${projection}: no renderer build: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** The backend's builds: each one's state, a terminal per run, and the run's output written to it. */
  private apply(entry: Folder, value: unknown) {
    const builds = (value as {builds?: Reported[]} | null)?.builds
    if (!Array.isArray(builds)) return
    let changed = false
    const reported = new Set(builds.map(item => item.projection))
    for (const [projection, build] of entry.builds) {
      if (reported.has(projection)) continue
      build.terminal?.end(null)
      entry.builds.delete(projection)
      changed = true
    }
    for (const item of builds) {
      const build = entry.builds.get(item.projection) ?? {state: stateOf(item), run: 0, running: false}
      entry.builds.set(item.projection, build)
      const state = stateOf(item)
      if (JSON.stringify(state) !== JSON.stringify(build.state) || build.running !== item.running) changed = true
      build.state = state
      if (item.phase === 'untrusted') void this.askTrust(entry.folder, item.projection)
      if (
        item.run > build.run &&
        item.phase !== 'untrusted' &&
        (item.running || (item.lines?.length !== undefined && item.lines.length > 0))
      ) {
        // A new run: its own task terminal.
        build.terminal?.end(null)
        build.run = item.run
        build.terminal = this.task(entry.folder, item.projection, item.script ?? 'build', item.script === 'watch')
      }
      if (item.lines?.length !== undefined && item.lines.length > 0) build.terminal?.write(item.lines)
      if (build.running && !item.running) build.terminal?.end(item.exit ?? 0)
      build.running = item.running
    }
    if (changed) this.changed.fire()
  }

  /** A background task whose terminal shows a run's output, for Problems and the person. */
  private task(folder: vscode.WorkspaceFolder, projection: string, script: string, watches: boolean): RelayTerminal {
    const terminal = new RelayTerminal(() => {
      // The person closed it (or terminated the task): the build stops.
      if (this.host.hasTab(folder, projection)) void this.send(folder, projection, 'closed')
    })
    const task = new vscode.Task(
      {type: rendererTaskType, projection, script},
      folder,
      `${projection} renderer`,
      'Projections',
      new vscode.CustomExecution(() => Promise.resolve(terminal)),
      ['$projections-renderer'],
    )
    task.isBackground = watches
    task.presentationOptions = {reveal: vscode.TaskRevealKind.Never, panel: vscode.TaskPanelKind.Dedicated, clear: false}
    void vscode.tasks.executeTask(task).then(
      execution => (terminal.execution = execution),
      (error: unknown) => this.output.warn(`${projection}: ${error instanceof Error ? error.message : String(error)}`),
    )
    this.output.info(`${projection}: the backend runs npm run ${script}`)
    return terminal
  }

  /** A saved file: when it is an open projection's custom renderer source, that renderer builds. */
  private async saved(uri: vscode.Uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri)
    if (!folder || uri.scheme !== 'file') return
    const path = vscode.workspace.asRelativePath(uri, false).replace(/\\/gu, '/')
    for (const definition of this.host.projections(folder)) {
      if (!isRendererSource(definition, path) || !this.host.hasTab(folder, definition.id)) continue
      await this.send(folder, definition.id, 'saved')
    }
  }

  /** A projection's tab opened: its renderer builds when its sources are newer than its bundle (saved while none was open). */
  async opened(folder: vscode.WorkspaceFolder, projection: string) {
    const definition = this.host.projections(folder).find(item => item.id === projection)
    if (!definition || !rendererPackage(definition)) return
    await this.send(folder, projection, 'opened')
  }

  /** Once per renderer: why nothing ran, with the way to trust the workspace. */
  private async askTrust(folder: vscode.WorkspaceFolder, projection: string) {
    const key = `${folder.uri.toString()}#${projection}`
    if (this.asked.has(key)) return
    this.asked.add(key)
    const manage = 'Manage Workspace Trust'
    const answer = await vscode.window.showInformationMessage(
      `Projections can rebuild the ${projection} renderer when you save its sources, by running its npm script. That is repository code: trust the workspace to allow it.`,
      manage,
    )
    if (answer === manage) await vscode.commands.executeCommand('workbench.trust.manage')
  }

  /** A watcher stops once no tab of its projection is open. */
  private tabsChanged() {
    for (const entry of this.folders.values()) {
      for (const projection of [...entry.builds.keys()]) {
        if (!this.host.hasTab(entry.folder, projection)) void this.send(entry.folder, projection, 'closed')
      }
    }
  }

  dispose() {
    for (const entry of this.folders.values()) {
      for (const build of entry.builds.values()) build.terminal?.end(null)
      entry.stop()
    }
    this.folders.clear()
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }
}
