/**
 * The agent viewer's page (`projections view`): the Inspector's bare stage with a one-line header and a quiet status
 * line, driven by the view state its server owns. The page long-polls the state (`view/state`), applies it through the
 * Inspector's handle, and reports what it presents and the person's selection and mode (`view/report`), so several
 * open pages mirror one another and the agent can read what is on screen. It names no files: errors are said in plain
 * words, and the agent reads the details through its tools.
 */

import type {InspectorHandle} from '../control.js'
import {mountInspector} from '../mount.js'
import type {MountedInspector} from '../mount.js'
import type {InspectorHost} from '../host.js'
import {InspectorRequestError, requestErrorMessage} from '../transport.js'
import type {InspectorTransport} from '../transport.js'
import {apply} from './apply.js'
import {pairKey, settle, unapplied} from './page.js'
import type {ViewerPage} from './page.js'
import {ViewerHeader, ViewerShown, createStore, mountWaiting} from './chrome.js'
import {pageView} from './page-view.js'
import {statusText} from './state.js'
import type {MountedViewer, MountViewerOptions, ViewerState} from './state.js'
import {markStatusBar, pageTheme} from './theme.js'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** The transport to the viewer's server: plain `fetch` under its base. */
function fetchTransport(base: URL, at: (path: string) => URL): InspectorTransport {
  return {
    origin: base.origin,
    async request({method, path, body, signal, responseType}) {
      const response = await fetch(at(path), {
        method,
        cache: 'no-store',
        ...(signal ? {signal} : {}),
        ...(body === undefined ? {} : {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}),
      })
      if (!response.ok) throw new InspectorRequestError(requestErrorMessage(response.status, await response.text()), response.status)
      return responseType === 'blob' ? response.blob() : response.json()
    },
  }
}

/** What the page reports: what it presents, and the person's selection and mode once the state has been applied. */
function reportBody(page: string, viewer: ViewerPage, handle: InspectorHandle, state: ViewerState) {
  const summary = handle.summary()
  const view = handle.view()
  return {
    page,
    generation: viewer.applied.settled ? state.generation : -1,
    selection: view?.selectedRow?.id ?? null,
    ...(view?.comparing ? {mode: view.mode} : {}),
    view: pageView(handle),
    summary,
    colorMode: view?.colorMode ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    width: innerWidth,
    height: innerHeight,
    ...(view ? {progress: view.progress} : {}),
  }
}

/** Mounts the viewer into `element`, served by `projections view` (or relayed to it by the host's `transport`). */
export function mountViewer(element: HTMLElement, options: MountViewerOptions = {}): MountedViewer {
  const base = new URL(options.base ?? new URL('./', document.baseURI))
  const at = (path: string) => new URL(path.replace(/^\//, ''), base)
  const transport = options.transport ?? fetchTransport(base, at)
  const host: InspectorHost = {...options.host, theme: options.host?.theme ?? pageTheme()}
  const page = crypto.randomUUID()
  const store = createStore()
  const abort = new AbortController()
  let mounted: MountedInspector | undefined
  const viewer: ViewerPage = {state: undefined, handle: null, shown: undefined, applied: unapplied(-1), reported: undefined}
  let reported = ''

  /** Reports what the page presents, and the person's selection and mode once the state has been applied. */
  async function report() {
    const {handle, state} = viewer
    if (!handle || !state || store.get().stopped) return
    settle(viewer, handle.view())
    store.set({status: statusText(state, handle.summary(), buildPhase())})
    const body = reportBody(page, viewer, handle, state)
    const text = JSON.stringify(body)
    if (text === reported) return
    reported = text
    if (body.generation >= 0)
      viewer.reported = {generation: body.generation, selection: body.selection, ...(body.mode ? {mode: body.mode} : {})}
    await transport.request({method: 'POST', path: '/view/report', body, signal: abort.signal}).catch(() => {})
  }

  /** Takes in one answer of the long poll: the build phase, and the state when it changed. */
  function receive(next: ViewerState & {build?: {version: number; phase: string | null}}) {
    if (next.build && next.build.version !== build?.version) {
      build = next.build
      if (viewer.state) store.set({status: statusText(viewer.state, viewer.handle?.summary(), buildPhase())})
    }
    if (next.generation === viewer.state?.generation) return
    viewer.state = next
    store.set({state: next, status: statusText(next, viewer.handle?.summary(), buildPhase())})
    if (next.title) document.title = `${next.title} · Projections`
    if (!mounted && next.projection) start(next)
    apply(viewer)
  }

  let instance: string | undefined
  async function poll() {
    let since: number | undefined
    while (!abort.signal.aborted) {
      try {
        // One long poll per page: the state, and the build phase with it (browsers allow few connections per host).
        const query = new URLSearchParams({
          page,
          ...(since === undefined ? {} : {since: String(since)}),
          ...(build ? {build: String(build.version)} : {}),
        })
        const next = (await transport.request({method: 'GET', path: `/view/state?${query}`, signal: abort.signal})) as ViewerState & {
          build?: {version: number; phase: string | null}
        }
        since = next.generation
        // Another server answers at this URL (one started with --trust replaced the last): what the page learned from
        // the last one (its trust, its renderers) no longer holds, so it loads afresh.
        if (instance !== undefined && next.instance !== undefined && next.instance !== instance) {
          if (options.onReplaced) options.onReplaced()
          else location.reload()
          return
        }
        instance = next.instance
        if (store.get().stopped) resume(next)
        receive(next)
      } catch {
        if (abort.signal.aborted) return
        // The next ask is answered at once, so a server that answers again is noticed then, not after a long poll.
        since = undefined
        stop()
        await sleep(2000)
      }
    }
  }

  /**
   * The server stopped answering (it exited, or the machine slept): the page says so over the stage, which takes no input
   * since nothing done there can reach the server, and keeps asking, so it resumes if the same viewer answers again.
   */
  function stop() {
    store.set({status: 'Viewer stopped', stopped: true})
    disable()
  }
  function resume(next: ViewerState) {
    store.set({stopped: false, status: statusText(next, viewer.handle?.summary(), buildPhase())})
    disable()
    reported = ''
  }

  /** The stage below the header takes no input while the page is stopped; the header and its notice stay readable. */
  function disable() {
    const stopped = store.get().stopped
    for (const body of element.querySelectorAll<HTMLElement>('.pi-viewer-body')) if (body.inert !== stopped) body.inert = stopped
  }

  /** The shown projection's custom renderer build phase, as the server sends it with the state. */
  let build: {version: number; phase: string | null} | undefined
  const buildPhase = () => build?.phase ?? undefined

  function start(first: ViewerState) {
    waiting.remove()
    mounted = mountInspector(element, {
      transport,
      host,
      view: 'inspect',
      chrome: 'viewer',
      ...(options.assets ? {assets: options.assets} : {}),
      banner: <ViewerHeader store={store} end={options.headerEnd} />,
      toolbarStart: <ViewerShown store={store} />,
      ...(first.definitionRevision ? {definitionRevision: first.definitionRevision} : {}),
      ...(first.projection && !first.scenario
        ? {
            initial: {
              projection: first.projection,
              after: first.after ?? 'working-tree',
              ...(first.before ? {before: first.before} : {}),
            },
          }
        : {}),
      onHandle(next) {
        viewer.handle = next
        if (next && viewer.state && !first.scenario) viewer.shown = {key: pairKey(first), refresh: first.refresh}
        apply(viewer)
      },
    })
  }

  // Before the agent shows anything, the page is only the status line.
  const waiting = mountWaiting(element, store, host)
  const timer = setInterval(() => {
    if (!mounted) return
    disable()
    apply(viewer)
    void report()
    markStatusBar()
  }, 400)
  void poll()
  return {
    unmount() {
      abort.abort()
      clearInterval(timer)
      waiting.remove()
      mounted?.unmount()
    },
  }
}
