/**
 * The agent viewer's page (`projections view`): the Inspector's bare stage with a one-line header and a quiet status
 * line, driven by the view state its server owns. The page long-polls the state (`view/state`), applies it through the
 * Inspector's handle, and reports what it presents and the person's selection and mode (`view/report`), so several
 * open pages mirror one another and the agent can read what is on screen. The person can show another of the
 * repository's projections from the title (`view/choose`), which becomes the state the agent reads. A page shows one
 * viewer: the default one, or one an agent named (`?viewer=NAME`), each with its own state. It names no files: errors
 * are said in plain words, and the agent reads the details through its tools.
 */

import {createActor} from '@githubnext/projections-machine'
import type {InspectorHandle} from '../control.js'
import {mountInspector} from '../mount.js'
import type {MountedInspector} from '../mount.js'
import type {InspectorHost} from '../host.js'
import {InspectorRequestError, requestErrorMessage} from '../transport.js'
import type {InspectorTransport} from '../transport.js'
import {apply} from './apply.js'
import {viewerConnection} from './lifecycle.js'
import type {Answer} from './lifecycle.js'
import {openRendererDocuments} from './documents.js'
import {markReady, pageId, pairKey, settle, unapplied} from './page.js'
import type {ViewerPage} from './page.js'
import {ViewerHeader, ViewerShown, createStore, mountWaiting} from './chrome.js'
import {ViewerPane} from './pane.js'
import {pageView} from './page-view.js'
import {statusText} from './state.js'
import type {MountedViewer, MountViewerOptions, ViewerState} from './state.js'
import {markStatusBar, viewerTheme} from './theme.js'

/** Waits `ms`, or until `signal` aborts. */
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      {once: true},
    )
  })

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
function reportBody(
  page: string,
  named: {viewer?: string},
  viewer: ViewerPage,
  handle: InspectorHandle,
  state: ViewerState,
  theme: {seeded: true} | {ignored: string} | undefined,
) {
  const summary = handle.summary()
  const view = handle.view()
  return {
    page,
    ...named,
    generation: viewer.applied.settled ? state.generation : -1,
    selection: view?.selectedRow?.id ?? null,
    ...(view?.comparing ? {mode: view.mode} : {}),
    view: pageView(handle),
    summary,
    colorMode: view?.colorMode ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    width: innerWidth,
    height: innerHeight,
    ...(view ? {progress: view.progress} : {}),
    ...(theme ? {theme} : {}),
  }
}

/** Mounts the viewer into `element`, served by `projections view` (or relayed to it by the host's `transport`). */
export function mountViewer(element: HTMLElement, options: MountViewerOptions = {}): MountedViewer {
  const base = new URL(options.base ?? new URL('./', document.baseURI))
  const at = (path: string) => new URL(path.replace(/^\//u, ''), base)
  const transport = options.transport ?? fetchTransport(base, at)
  const themed = viewerTheme(options.host?.theme)
  const host: InspectorHost = {...options.host, theme: themed.theme}
  const page = pageId()
  // A capture (`projections view screenshot --page`) watches without being counted or reporting: it isn't the person's.
  const capture = options.capture ?? new URLSearchParams(location.search).has('capture')
  // The viewer this page shows: the one the options or the page's URL name, else the default one.
  const name = options.viewer ?? new URLSearchParams(location.search).get('viewer') ?? undefined
  const named = name && name !== 'default' ? {viewer: name} : {}
  const stopDocuments = openRendererDocuments(!options.transport)
  const store = createStore()
  if (themed.notice) store.set(themed.notice)
  const abort = new AbortController()
  let mounted: MountedInspector | undefined
  const viewer: ViewerPage = {id: page, state: undefined, handle: null, shown: undefined, applied: unapplied(-1)}
  // Before the agent shows anything, the page is only the status line.
  const waiting = mountWaiting(element, store, host)

  // The connection to the server (lifecycle.ts): the long poll, stopping and resuming, a replacing server, and the
  // reports, one at a time.
  const connection = createActor(viewerConnection, {
    state: {
      kind: 'live',
      state: undefined,
      instance: undefined,
      build: undefined,
      mounted: false,
      outbox: {sending: null, next: null, seq: 0, last: ''},
      asks: 0,
      since: undefined,
    },
    effects: {
      show: ({state: next, mount}) => {
        viewer.state = next
        store.set({state: next, status: statusText(next, viewer.handle?.summary(), buildPhase()), choosing: undefined, failed: undefined})
        if (next.title) document.title = `${next.title} · Projections`
        if (mount) start(next)
        apply(viewer)
      },
      build: () => {
        if (viewer.state) store.set({status: statusText(viewer.state, viewer.handle?.summary(), buildPhase())})
      },
      // The server stopped answering (it exited, or the machine slept): the page says so over the stage, which takes no
      // input since nothing done there can reach the server, and keeps asking, so it resumes if the same viewer answers again.
      stop: () => {
        store.set({status: 'Viewer stopped', stopped: true})
        store.focus({type: 'stopped'})
        disable()
      },
      resume: ({state: next}) => {
        store.set({stopped: false, status: statusText(next, viewer.handle?.summary(), buildPhase())})
        disable()
      },
      // Another server answers at this URL (one started with --trust replaced the last): what the page learned from the
      // last one (its trust, its renderers) no longer holds, so it loads afresh.
      reload: () => (options.onReplaced ? options.onReplaced() : location.reload()),
    },
    activities: {
      // The report in flight; a page that stops abandons it.
      post: ({body}, {send, signal}) =>
        transport
          .request({method: 'POST', path: '/view/report', body, signal})
          .catch(() => {})
          .finally(() => send({type: 'posted'})),
      // One long poll per page: the state, and the build phase with it (browsers allow few connections per host).
      poll: async ({since, build, delayMs}, {send, signal}) => {
        if (delayMs) await sleep(delayMs, signal)
        if (signal.aborted) return
        const query = new URLSearchParams({
          ...(capture ? {} : {page}),
          ...named,
          ...(since === undefined ? {} : {since: String(since)}),
          ...(build === undefined ? {} : {build: String(build)}),
        })
        try {
          send({type: 'answered', answer: (await transport.request({method: 'GET', path: `/view/state?${query}`, signal})) as Answer})
        } catch {
          send({type: 'failed'})
        }
      },
    },
  })

  /** Reports what the page presents, and the person's selection and mode once the state has been applied. */
  function report() {
    const {handle, state} = viewer
    if (!handle || !state || connection.getState().kind !== 'live') return
    settle(viewer, handle.view())
    store.set({status: statusText(state, handle.summary(), buildPhase())})
    markReady(viewer, handle, buildPhase())
    const body = reportBody(page, named, viewer, handle, state, themed.report)
    if (!capture) connection.send({type: 'report', report: {body, text: JSON.stringify(body)}})
  }

  /** The stage below the header takes no input while the page is stopped; the header and its notice stay readable. */
  function disable() {
    const stopped = store.get().stopped
    for (const body of element.querySelectorAll<HTMLElement>('.pi-viewer-body')) if (body.inert !== stopped) body.inert = stopped
  }

  /** Shows the projection the person chose from the title: the viewer's state follows, for every page and the agent. */
  async function choose(projection: string) {
    const title = store.get().projections.find(item => item.id === projection)?.title ?? projection
    store.set({choosing: projection, failed: undefined})
    try {
      await transport.request({method: 'POST', path: '/view/choose', body: {...named, projection}, signal: abort.signal})
    } catch {
      if (abort.signal.aborted) return
      if (store.get().choosing === projection) store.set({choosing: undefined, failed: `Couldn't show ${title}`})
    }
  }

  /** The repository's projections and the page's color mode, for the title's menu, when they change. */
  let listed = ''
  function list(handle: InspectorHandle) {
    const projections = handle.summary().projections
    const key = JSON.stringify(projections)
    if (key !== listed) {
      listed = key
      store.set({projections})
    }
    const colorMode = handle.view()?.colorMode
    if (colorMode) store.set({colorMode})
  }

  /** The shown projection's custom renderer build phase, as the server sends it with the state. */
  function buildPhase() {
    const current = connection.getState()
    return (current.kind === 'live' || current.kind === 'stopped' ? current.build?.phase : undefined) ?? undefined
  }

  function start(first: ViewerState) {
    waiting.remove()
    mounted = mountInspector(element, {
      transport,
      host,
      view: 'inspect',
      chrome: 'viewer',
      ...(options.assets ? {assets: options.assets} : {}),
      banner: <ViewerHeader store={store} end={options.headerEnd} onChoose={projection => void choose(projection)} />,
      aside: <ViewerPane store={store} onChoose={projection => void choose(projection)} />,
      utilityArea: true,
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

  const timer = setInterval(() => {
    if (!mounted) return
    disable()
    if (viewer.handle) list(viewer.handle)
    apply(viewer)
    report()
    markStatusBar()
  }, 400)
  connection.start()
  return {
    unmount() {
      abort.abort()
      connection.send({type: 'unmounted'})
      connection.stop()
      clearInterval(timer)
      waiting.remove()
      mounted?.unmount()
      stopDocuments()
    },
  }
}
