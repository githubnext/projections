import type {ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import {createWorkerEngine} from '@githubnext/projections-engine/worker'
import type {WorkerEngine, WorkerEngineOptions} from '@githubnext/projections-engine/worker'
import {loadArtifact} from '@githubnext/projections-engine/artifacts'
import {createRulesRuntime} from '@githubnext/projections-comparator-runtime/browser'
import {LoadingStatus, loadRendererCatalog} from '@githubnext/projections-host'
import {Alert, AlertDescription, Button, ScopedRoot, useColorMode} from '@githubnext/projections-host/ui/components'
import {CircleAlert} from 'lucide-react'
import type {RendererEntry} from '@githubnext/projections-host'
import {InspectorApp} from './index.js'
import type {InspectorAppProps, InspectorOpenedOn} from './index.js'
import {createInspectorClient} from './client/create.js'
import type {InspectorApi} from './client/api.js'
import {InspectorRequestError, including} from './transport.js'
import type {InspectorTransport} from './transport.js'
import {InspectorHostProvider, externalUrl, useHostTheme} from './host.js'
import type {InspectorHost} from './host.js'
import type {InspectorHandle} from './control.js'
import {FixturesStore} from './fixtures/session.js'
import {FixturesWorkbench} from './fixtures/workbench.js'
import {StagePage} from './fixtures/stage-page.js'
import {ExplorePage} from './explore.js'
import type {SweepLabels} from './sweep/grid.js'
import {SnapshotPage} from './snapshot/page.js'
import {customRendererPrefix, snapshotSettings} from './snapshot/settings.js'
import {markSnapshot} from './snapshot/marker.js'
import {snapshotDocument} from './snapshot/document.js'

export type {InspectorHost, InspectorHostTheme} from './host.js'
export type {InspectorOpenedOn} from './index.js'
export type {
  InspectorHandle,
  InspectorKeptResult,
  InspectorPairRequest,
  InspectorResultIdentity,
  InspectorRunning,
  InspectorSummary,
} from './control.js'
export type {InspectorTransport, InspectorTransportRequest, InspectorChangeChannel, TransportMessage, TransportReply} from './transport.js'
/** The host's renderer catalog loader, for hosts that supply their own `InspectorAssets.renderers`. */
export {loadRendererCatalog} from '@githubnext/projections-host'
/** Renderer documents as Blob URLs with the page's script nonce, for hosts whose frames load them that way. */
export {rendererBlobDocument} from '@githubnext/projections-host'
export {relayRendererFrames} from './frames.js'
export {
  createMessageTransport,
  including,
  InspectorRequestError,
  isApiPath,
  parseTransportMessage,
  requestErrorMessage,
  transportTag,
} from './transport.js'

/**
 * Where the Inspector's browser assets are: the shared engine (its Worker and Wasm modules), the comparator
 * runtime's Worker and the rules interpreter, and the built-in renderer bundles. A web page serves them beside itself
 * (`webAssets`); a host whose document can't start Workers from its resource URLs supplies Blob URLs and bytes.
 */
export interface InspectorAssets {
  engine: Pick<WorkerEngineOptions, 'workerUrl' | 'wasm' | 'comparator'>
  comparator: {workerUrl: URL | string; rulesInterpreterUrl: URL | string}
  /** The built-in renderer bundles; without any, the host's table and text views still present everything. */
  renderers(): Promise<RendererEntry[]>
}

/** The assets as the Inspector's build lays them out under `base` (by default, beside the page). */
export function webAssets(base: URL | string = new URL('./', document.baseURI)): InspectorAssets {
  const at = (path: string) => new URL(path, base)
  return {
    engine: {
      workerUrl: at('engine/worker-entry.js'),
      wasm: {url: at('engine/engine.wasm')},
      comparator: {url: at('engine/default-comparator.wasm')},
    },
    comparator: {workerUrl: at('comparator/worker-entry.js'), rulesInterpreterUrl: at('comparator/rules.wasm')},
    async renderers() {
      try {
        return await loadRendererCatalog({base: at('renderers/')})
      } catch {
        return []
      }
    },
  }
}

/** The options of `mountInspector`: the runner's transport, the host's capabilities and assets, and what to open. */
export interface MountInspectorOptions {
  transport: InspectorTransport
  host?: InspectorHost
  assets?: InspectorAssets
  /**
   * The view to open (the page's `?view=`): `explore` (the Explore view), `inspect` (the Inspector, even in an
   * explore session), or the headless pages' `snapshot` and `stage`. By default an explore session opens on Explore.
   */
  view?: string | null
  /**
   * Follow the pages' own `?view=` links by switching the mounted view, for hosts without page navigation (webviews).
   * A link's `projection`, `before` and `after` (as Explore's sweep opens a change) become the next `initial`.
   */
  viewLinksInPlace?: boolean
  /**
   * The projection and pair the Inspector opens on, instead of the page's `?projection&before&after`. The projection
   * may be an explore candidate the runner offers but doesn't list; the Inspector asks for it to be listed too.
   */
  initial?: InspectorOpenedOn
  /** The page's query, for the snapshot view's settings. */
  search?: string
  /** Receives the handle a host drives the Inspector with, once it is shown (`null` when it goes away). */
  onHandle?: (handle: InspectorHandle | null) => void
  /** A host UI's projection view (see `InspectorAppProps.projectionView`), such as the VS Code UI's. */
  projectionView?: InspectorAppProps['projectionView']
  /** The Explore view's recent-changes grid copy, in the host's words (its buttons and empty state). */
  sweepLabels?: SweepLabels
  /** A host UI's loading state (see `InspectorAppProps.loadingStatus`), also while the engine starts. */
  loadingStatus?: InspectorAppProps['loadingStatus']
  /**
   * `none` presents only the projection (`initial.projection`) and its notices, with no Inspector shell, for a host
   * that shows one projection per editor tab (see `InspectorAppProps.chrome`).
   */
  chrome?: InspectorAppProps['chrome']
  /** A line above the projection in a bare view (see `InspectorAppProps.banner`), such as the viewer's header. */
  banner?: InspectorAppProps['banner']
  /** What a one-revision view shows, at its toolbar's start (see `InspectorAppProps.toolbarStart`), such as the viewer's. */
  toolbarStart?: InspectorAppProps['toolbarStart']
  /** `manual`: working-tree changes don't extract the shown pair again; the host refreshes (see `InspectorAppProps.refresh`). */
  refresh?: InspectorAppProps['refresh']
  /**
   * Extractions of `initial.projection` the host kept (`InspectorHandle.results`), by ref, presented as they are
   * instead of extracting those refs again: a webview that was dropped while hidden comes back as it was.
   */
  initialResults?: InspectorAppProps['initialResults']
  /** The revision whose definition applies to both sides (see `InspectorAppProps.definitionRevision`). */
  definitionRevision?: InspectorAppProps['definitionRevision']
}

/** What `mountInspector` returns: the Inspector's handle once it has started, and `unmount` to remove it. */
export interface MountedInspector {
  /** The handle, once the Inspector has started and shows a repository or artifact. */
  handle(): Promise<InspectorHandle>
  unmount(): void
}

/** Root attributes the browser checks read: `data-projections-stage="failed"` when startup couldn't continue. */
function markFailed() {
  document.documentElement.dataset.projectionsStage = 'failed'
}

/** The full-viewport frame shown while starting, or when startup can't continue. */
export function StartupShell({children}: {children: ReactNode}) {
  const host = useHostTheme()
  const system = useColorMode()
  return (
    <ScopedRoot colorMode={host?.colorMode ?? system} className="pi">
      <div className="pj:flex pj:min-h-dvh pj:items-center pj:justify-center pj:bg-background pj:p-6 pj:text-foreground">
        <div className="pj:flex pj:w-full pj:max-w-lg pj:flex-col pj:gap-3">{children}</div>
      </div>
    </ScopedRoot>
  )
}

/** Applies the host theme's accent to the Inspector's lens color (focus, selection, playback). */
function applyAccent(element: HTMLElement, host: InspectorHost | undefined) {
  const update = () => {
    const accent = host?.theme?.get().accent
    if (accent && CSS.supports('color', accent)) {
      element.dataset.piAccent = ''
      element.style.setProperty('--pi-accent', accent)
    } else {
      delete element.dataset.piAccent
      element.style.removeProperty('--pi-accent')
    }
  }
  update()
  return host?.theme?.subscribe(update) ?? (() => {})
}

/**
 * Mounts the Inspector into `element`: it starts the shared engine, reads the runner through `transport` and
 * presents the repository (or the runner's document, or its fixtures). Host capabilities are optional; without
 * them it behaves as the web page does.
 */
export function mountInspector(element: HTMLElement, options: MountInspectorOptions): MountedInspector {
  const {transport, host} = options
  let view = options.view ?? null
  let initial = options.initial
  const assets = options.assets ?? webAssets()
  const root = createRoot(element)
  const render = (node: ReactNode) => root.render(<InspectorHostProvider host={host}>{node}</InspectorHostProvider>)
  let api: InspectorApi = createInspectorClient({transport})
  const rules = createRulesRuntime({workerUrl: assets.comparator.workerUrl, rulesInterpreterUrl: assets.comparator.rulesInterpreterUrl})
  let workerEngine: WorkerEngine | undefined
  let disposed = false
  const stops: (() => void)[] = [applyAccent(element, host)]
  let resolveHandle: (handle: InspectorHandle) => void
  const handled = new Promise<InspectorHandle>(resolve => (resolveHandle = resolve))
  const handleRef = (handle: InspectorHandle | null) => {
    if (handle) resolveHandle(handle)
    options.onHandle?.(handle)
  }
  // A host may open external links itself (an editor's browser); same-origin and non-web links are left alone.
  if (host?.openExternal) {
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      const url = anchor && externalUrl(anchor.getAttribute('href'), document.baseURI)
      if (!url) return
      event.preventDefault()
      host.openExternal!(url)
    }
    element.addEventListener('click', click)
    stops.push(() => element.removeEventListener('click', click))
  }
  if (options.viewLinksInPlace) {
    const click = (event: MouseEvent) => {
      const href = (event.target as Element | null)?.closest?.('a[href]')?.getAttribute('href')
      const query = href?.startsWith('?') ? new URLSearchParams(href) : undefined
      const next = query?.get('view')
      if (!query || !next) return
      event.preventDefault()
      view = next
      const opened = Object.fromEntries(
        (['projection', 'before', 'after'] as const).flatMap(key => (query.get(key) ? [[key, query.get(key)!]] : [])),
      ) as InspectorOpenedOn
      initial = Object.keys(opened).length ? opened : undefined
      workerEngine?.dispose()
      void start()
    }
    element.addEventListener('click', click)
    stops.push(() => element.removeEventListener('click', click))
  }
  const pagehide = (event: PageTransitionEvent) => {
    if (!event.persisted) {
      disposed = true
      workerEngine?.dispose()
    }
  }
  addEventListener('pagehide', pagehide)
  stops.push(() => removeEventListener('pagehide', pagehide))

  async function start() {
    api = createInspectorClient({transport: initial?.projection ? including(transport, initial.projection) : transport})
    const Loading = options.loadingStatus ?? LoadingStatus
    render(
      <StartupShell>
        <Loading label="Starting the shared engine…" />
      </StartupShell>,
    )
    try {
      workerEngine?.dispose()
      workerEngine = await createWorkerEngine(assets.engine)
      if (disposed) {
        workerEngine.dispose()
        return
      }
      const engine = workerEngine
      const decode = (json: string) => loadArtifact(json, {engine})
      const renderers = assets.renderers()
      // A viewer's server presents a repository, never fixtures, and doesn't answer for them.
      const fixtures = options.chrome === 'viewer' ? null : await api.fixtures()
      if (fixtures) {
        const context = {api, engine, rules, builtins: await renderers}
        const store = new FixturesStore(context, fixtures)
        void store.watch()
        const stop = () => store.stop()
        addEventListener('pagehide', stop)
        stops.push(stop, () => removeEventListener('pagehide', stop))
        render(view === 'stage' ? <StagePage store={store} context={context} /> : <FixturesWorkbench store={store} context={context} />)
        return
      }
      const [supplied, base] = await Promise.all([
        api.document(),
        api.renderers().then(
          list => list?.customRendererBase,
          () => undefined,
        ),
      ])
      // An explore session opens on its Explore view; `inspect` opens the Inspector.
      if (!supplied && (view === 'explore' || (view === null && (await api.explore().catch(() => undefined))?.session))) {
        render(<ExplorePage api={api} {...(options.sweepLabels ? {sweepLabels: options.sweepLabels} : {})} />)
        return
      }
      if (view === 'snapshot') {
        // Presents the document the CLI computed, as `projections snapshot` asked.
        const settings = snapshotSettings(options.search ?? '')
        if (!supplied) throw new Error('The snapshot page needs a document; it is opened by projections snapshot')
        const snapshot = await snapshotDocument(supplied, engine)
        const custom =
          settings.definition && !settings.withheld
            ? customRendererPrefix(await transport.request({method: 'GET', path: '/api/renderers'}), transport.origin)
            : undefined
        render(<SnapshotPage document={snapshot} settings={settings} renderers={await renderers} customRendererBase={custom} />)
        return
      }
      const initialDocument = supplied ? await decode(JSON.stringify(supplied)) : undefined
      render(
        <InspectorApp
          {...(supplied ? {} : {api})}
          engine={engine}
          loadArtifact={decode}
          renderers={await renderers}
          rules={rules}
          handleRef={handleRef}
          {...(options.projectionView ? {projectionView: options.projectionView} : {})}
          {...(options.loadingStatus ? {loadingStatus: options.loadingStatus} : {})}
          {...(options.chrome ? {chrome: options.chrome} : {})}
          {...(options.banner ? {banner: options.banner} : {})}
          {...(options.toolbarStart ? {toolbarStart: options.toolbarStart} : {})}
          {...(options.refresh ? {refresh: options.refresh} : {})}
          {...(options.initialResults ? {initialResults: options.initialResults} : {})}
          {...(options.definitionRevision ? {definitionRevision: options.definitionRevision} : {})}
          {...(initial ? {initial} : {})}
          {...(base ? {customRendererBase: base} : {})}
          {...(initialDocument ? {initialDocument} : {})}
        />,
      )
    } catch (failure) {
      workerEngine?.dispose()
      if (disposed) return
      markFailed()
      if (view === 'snapshot') markSnapshot('failed', failure instanceof Error ? failure.message : String(failure))
      render(
        <StartupShell>
          <Alert variant="destructive" className="pi-error">
            <CircleAlert className="pj:h-4 pj:w-4" />
            <AlertDescription className="pj:break-words">
              Could not start the Inspector: {failure instanceof Error ? failure.message : String(failure)}
            </AlertDescription>
          </Alert>
          <Button type="button" variant="outline" className="pj:self-start" onClick={() => void start()}>
            Retry startup
          </Button>
        </StartupShell>,
      )
    }
  }
  void start()
  return {
    handle: () => handled,
    unmount() {
      disposed = true
      workerEngine?.dispose()
      for (const stop of stops.splice(0)) stop()
      root.unmount()
    },
  }
}
