import * as vscode from 'vscode'
import {execFile} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {promisify} from 'node:util'
import {parseTransportMessage} from '@githubnext/projections-inspector/transport'
import {sourceRoot} from '../backend-sources.js'
import type {PanelSource} from '../backend-sources.js'
import type {Lease} from '../backends.js'
import {createActor} from '@githubnext/projections-machine'
import {createBridge} from '../bridge.js'
import {openExternal} from '../docs.js'
import {webviewHtml} from '../html.js'
import {count} from '../probe.js'
import {controlTag, hostTag, position, relativePath, rendererTag, revision} from '../protocol.js'
import type {ControlRequest, HostMessage, WebviewConfig} from '../protocol.js'
import type {Runner} from '../runner.js'
import type {Services} from '../services.js'
import {pageLifecycle} from './page-lifecycle.js'

const run = promisify(execFile)

/**
 * A webview presenting a source's Inspector on its shared backend: the Inspector panel, or a projection tab. It relays
 * the webview's transport to the backend and answers its host capabilities (opening files, the clipboard, links).
 */
export class InspectorWebview {
  protected readonly context: vscode.ExtensionContext
  protected readonly output: vscode.LogOutputChannel
  protected readonly lease: Lease
  protected runner: Runner | undefined
  protected bridge: ReturnType<typeof createBridge> | undefined
  /** How many times the extension loaded the page; the page says which load it is when it's ready. */
  private pageLoads = 0
  private nextControl = 1
  /** The callers waiting on each control the page's lifecycle hasn't settled. */
  private readonly answers = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void}>()
  /** The page's lifecycle (page-lifecycle.ts): loading, ready or closed, and the controls waiting on it. */
  protected readonly page = createActor(pageLifecycle, {
    state: {kind: 'loading', page: 0, waiting: []},
    effects: {
      post: ({control}) => void this.panel.webview.postMessage({tag: controlTag, id: control.id, ...control.message}),
      resolve: ({id, result}) => this.settle(id)?.resolve(result),
      reject: ({id, reason}) => this.settle(id)?.reject(new Error(reason)),
    },
    onError: error => this.output.error(error instanceof Error ? error : String(error)),
  })
  /** Transport requests the page sent before a backend was bound: answered, in order, once one is. */
  private queued: unknown[] = []
  /** For tests: the first page this webview was given, when, and when its first backend was bound. */
  firstPage: {html: string; at: number} | undefined
  boundAt: number | undefined
  protected readonly disposables: vscode.Disposable[] = []

  protected readonly services: Services
  readonly source: PanelSource
  readonly panel: vscode.WebviewPanel
  protected view: 'explore' | 'inspect'

  /** `firstPage`: the document a projection tab's editor showed first, before its page (for tests). */
  constructor(
    services: Services,
    source: PanelSource,
    panel: vscode.WebviewPanel,
    view: 'explore' | 'inspect',
    firstPage?: {html: string; at: number},
  ) {
    this.services = services
    this.source = source
    this.panel = panel
    this.view = view
    this.context = services.context
    this.output = services.output
    this.firstPage = firstPage
    this.page.start()
    this.lease = services.backends.lease(source)
    // A replaced backend (with --trust once the workspace is trusted, or after it exited) gets a new bridge and page.
    const unsubscribe = this.lease.onDidChange(runner => this.bind(runner))
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage(message => this.receive(message)),
      {dispose: unsubscribe},
    )
  }

  // Hooks a projection tab implements; the Inspector panel has none.
  /** More configuration for the page, such as a projection tab's projection. */
  protected pageConfig?(): Partial<WebviewConfig>

  /** A projection tab's summary report. */
  protected summary?(summary: unknown): void

  /** The page's `ready`, which a projection tab's carries its pinned pair. */
  protected onReady?(message: Partial<HostMessage>): void

  /** A projection tab's toolbar asked to change its pair. */
  protected pairAction?(action: unknown): void

  /** The page asked the backend for something (a projection tab counts its extraction jobs). */
  protected request?(method: 'GET' | 'POST', path: string): void

  /**
   * Shows the page at once and binds the backend when it is ready: the page loads (its script, Workers and skeleton) in
   * parallel with the backend's start, and its requests wait for the bridge, so the backend's arrival never reloads it.
   */
  async start() {
    const webview = this.panel.webview
    this.show(this.view)
    try {
      // A test-only hold on the backend, to picture the tab before it's ready.
      const hold = Number(process.env.PROJECTIONS_TEST_HOLD_BACKEND_MS ?? 0)
      if (hold > 0) await new Promise(resolve => setTimeout(resolve, Math.min(hold, 60_000)))
      const runner = await this.lease.current()
      // A replacement that arrived meanwhile already bound (and reloaded) the page.
      if (!this.runner) this.attach(runner)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.output.error(message)
      webview.html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><body><p>${message.replace(/[<&]/gu, c => (c === '<' ? '&lt;' : '&amp;'))}</p></body>`
      void vscode.window.showErrorMessage(`Projections: ${message}`)
    }
  }

  /** Talks to a replaced backend from now on: a new bridge, and the page loaded again. */
  protected bind(runner: Runner) {
    this.attach(runner)
    this.show(this.view)
  }

  /** Talks to `runner` from now on: a new bridge, which answers the requests the page sent while there was none. */
  private attach(runner: Runner) {
    const webview = this.panel.webview
    this.bridge?.dispose()
    this.runner = runner
    void runner.exited.then(code => {
      if (this.runner === runner) this.output.warn(`The Projections backend exited (${code})`)
    })
    this.bridge = createBridge(runner, reply => void webview.postMessage(reply), {
      onRequest: (method, path) => this.request?.(method, path),
    })
    this.boundAt ??= Date.now()
    const queued = this.queued
    this.queued = []
    for (const message of queued) this.bridge.receive(message)
  }

  /** (Re)loads the webview page on a view; the runner keeps running. */
  show(view: 'explore' | 'inspect') {
    const webview = this.panel.webview
    this.view = view
    const page = ++this.pageLoads
    this.page.send({type: 'loaded', page})
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist')
    const resource = (...path: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(dist, ...path)).toString()
    const config: WebviewConfig = {
      assets: `${resource('inspector')}/`,
      engineWorker: resource('workers', 'engine.js'),
      comparatorWorker: resource('workers', 'comparator.js'),
      nonce: randomBytes(18).toString('base64url'),
      view,
      page,
      ...this.pageConfig?.(),
    }
    count('page.load')
    webview.html = webviewHtml({
      cspSource: webview.cspSource,
      config,
      styles: [resource('inspector', 'mount.css'), resource('vscode-ui', 'styles.css'), resource('vscode-ui', 'inspector.css')],
      codicons: resource('vscode-ui', 'codicons', 'codicon.css'),
      script: resource('webview.js'),
    })
    this.firstPage ??= {html: webview.html, at: Date.now()}
  }

  protected receive(message: unknown) {
    if (this.bridge?.receive(message)) return
    if (!this.bridge && parseTransportMessage(message)) {
      // Before the backend is bound: kept until it is (bounded, as a page sends a handful).
      if (this.queued.length < 1000) this.queued.push(message)
      return
    }
    const host = message as Partial<HostMessage> | null | undefined
    if (host?.tag !== hostTag) return
    switch (host.op) {
      case 'ready': {
        // A ready from an earlier load, whose HTML was already replaced, isn't this page's.
        const page = typeof host.page === 'number' ? host.page : undefined
        const before = this.page.getState()
        this.page.send({type: 'ready', page})
        if (before.kind !== 'closed' && (page === undefined || page === before.page)) this.onReady?.(host)
        return
      }
      case 'controlResult':
        if (typeof host.id === 'number') {
          this.page.send({
            type: 'answered',
            id: host.id,
            result: host.result,
            ...(host.error ? {error: host.error} : {}),
          })
        }
        return
      case 'openFile':
        void this.openFile(host.path, host.line, host.column)
        return
      case 'revealInScm':
        void this.revealInScm(host.ref)
        return
      case 'copyText':
        if (typeof host.text === 'string' && host.text.length <= 4 * 1024 * 1024) void vscode.env.clipboard.writeText(host.text)
        return
      case 'rendererFile': {
        const {id, path} = host as {id?: unknown; path?: unknown}
        const bridge = this.bridge
        if (typeof id !== 'number' || !bridge) return
        void bridge.rendererFile(path).then(file => void this.panel.webview.postMessage({tag: rendererTag, id, ...file}))
        return
      }
      case 'openExternal': {
        const url = typeof host.url === 'string' ? vscode.Uri.parse(host.url, true) : undefined
        if (url && (url.scheme === 'https' || url.scheme === 'http')) void openExternal(url)
        return
      }
      case 'addToCi':
        void vscode.commands.executeCommand('projections.addToCi', 'agent')
        return
      case 'summary':
        this.summary?.(host.summary)
        return
      case 'pairAction':
        this.pairAction?.((host as {action?: unknown}).action)
    }
  }

  /** Opens a repository-relative file at a line and column; paths outside the repository are refused. */
  private async openFile(path: unknown, line: unknown, column: unknown) {
    const relative = relativePath(path)
    if (!relative) return
    const uri = vscode.Uri.joinPath(sourceRoot(this.source), ...relative.split('/'))
    const row = (position(line) ?? 1) - 1
    const character = (position(column) ?? 1) - 1
    try {
      await vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
        selection: new vscode.Range(row, character, row, character),
      })
    } catch (error) {
      void vscode.window.showWarningMessage(`Projections: could not open ${relative}: ${error instanceof Error ? error.message : error}`)
    }
  }

  /** Shows the Source Control view; a commit or ref is resolved and offered for copying, as VS Code has no commit view API. */
  private async revealInScm(ref: unknown) {
    const checked = revision(ref)
    if (!checked) return
    await vscode.commands.executeCommand('workbench.view.scm')
    if (checked === 'working-tree') return
    try {
      const {stdout} = await run('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${checked}^{commit}`], {
        cwd: sourceRoot(this.source).fsPath,
      })
      const commit = stdout.trim()
      const choice = await vscode.window.showInformationMessage(`${checked} is ${commit.slice(0, 12)}`, 'Copy commit')
      if (choice) await vscode.env.clipboard.writeText(commit)
    } catch {
      void vscode.window.showWarningMessage(`Projections: ${checked} is not a commit in this repository`)
    }
  }

  /**
   * Sends a command to the webview's Inspector handle once it is ready. It fails when the page doesn't answer within
   * `timeoutMs` of the call (waiting for the page included), when the page reloads before answering, or when it closes.
   */
  control(message: ControlRequest, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextControl++
    return new Promise((resolve, reject) => {
      this.answers.set(id, {resolve, reject})
      this.page.send({type: 'asked', control: {id, message, timeoutMs}})
    })
  }

  /** The caller waiting on control `id`, no longer waiting. */
  private settle(id: number) {
    const answer = this.answers.get(id)
    this.answers.delete(id)
    return answer
  }

  /** Whether the panel is closed: posting to it would throw. */
  protected closed = false

  protected dispose() {
    this.closed = true
    this.bridge?.dispose()
    this.lease.dispose()
    // The lifecycle stays running, closed: a command asked for after this fails at once.
    this.page.send({type: 'closed'})
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
  }
}
