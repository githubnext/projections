import {useSyncExternalStore} from 'react'
import type {ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import {ProjectionsMark, cn} from '@githubnext/projections-host/ui/components'
import {InspectorHostProvider} from '../host.js'
import type {InspectorHost} from '../host.js'
import {StartupShell} from '../mount.js'
import type {SwitcherItem} from '../shell/switcher.js'
import type {ViewerState} from './state.js'
import {ViewerTitle} from './title.js'

interface Snapshot {
  state: ViewerState | undefined
  status: string
  /** The page lost its server: the controls are disabled until it answers again. */
  stopped: boolean
  /** The repository's projections, for the title's menu, as the Inspector lists them. */
  projections: readonly SwitcherItem[]
  /** The page's color mode, for the title's menu. */
  colorMode: 'light' | 'dark'
  /** The projection the person just chose, shown in the title until the viewer's state says it. */
  choosing?: string | undefined
  /** Why the person's choice didn't take, said in the status line until the state changes. */
  failed?: string | undefined
}

/** A tiny store the header reads. */
export function createStore() {
  let snapshot: Snapshot = {state: undefined, status: 'Connecting…', stopped: false, projections: [], colorMode: 'light'}
  const listeners = new Set<() => void>()
  return {
    get: () => snapshot,
    set(next: Partial<Snapshot>) {
      if (Object.entries(next).every(([key, value]) => snapshot[key as keyof Snapshot] === value)) return
      snapshot = {...snapshot, ...next}
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
export type Store = ReturnType<typeof createStore>

/**
 * The one-line header: the Projections mark and the projection's title, then at its end the status line and what is
 * compared. The mark takes no more height than the text's cap (styles.css), so the header keeps its height. What is
 * compared keeps its words up to about half the row, each named revision a chip that shortens with an ellipsis and
 * says its name in full on hover; the title takes the rest, and shortens first. Its text is centred by cap height
 * (styles.css). The title is also the menu of the repository's projections (`onChoose`, title.tsx). A host's own
 * control (`end`) closes the row.
 */
export function ViewerHeader({store, end, onChoose}: {store: Store; end?: ReactNode; onChoose?: (projection: string) => void}) {
  const {state, status, stopped, projections, colorMode, choosing, failed} = useSyncExternalStore(store.subscribe, store.get, store.get)
  const shown = choosing ?? state?.projection ?? undefined
  const title = shown
    ? choosing
      ? (projections.find(item => item.id === choosing)?.title ?? choosing)
      : (state?.title ?? shown)
    : 'Projections'
  const line = failed ?? status
  return (
    <header className="pi-viewer-header pj:relative pj:z-20 pj:flex pj:min-w-0 pj:shrink-0 pj:items-center pj:gap-3 pj:border-b pj:border-divider pj:bg-surface-header pj:p-3 pj:text-[13px]">
      <ProjectionsMark tone="two-tone" className="pi-viewer-mark pj:text-foreground" />
      <ViewerTitle
        title={title}
        current={shown}
        projections={projections}
        colorMode={colorMode}
        onChoose={stopped ? undefined : onChoose}
      />
      {line && (
        <span
          role="status"
          aria-live="polite"
          title={line}
          className={cn(
            'pi-viewer-status pi-viewer-text pj:min-w-0 pj:max-w-[40%] pj:truncate pj:text-xs',
            stopped || failed ? 'pj:font-medium pj:text-foreground' : 'pj:text-muted-foreground',
          )}
        >
          {line}
        </span>
      )}
      {state?.projection && <Compared state={state} />}
      {end}
      {stopped && <Stopped className="pj:absolute pj:inset-x-0 pj:top-full pj:h-dvh" />}
    </header>
  )
}

/**
 * The page lost its server: a veil over everything below the header, saying so, and how to get the view back. The page
 * is inert meanwhile (mount.tsx), so no control seems to work and doesn't.
 */
function Stopped({className}: {className: string}) {
  return (
    <div
      role="alert"
      className={cn(
        'pi-viewer-stopped pj:flex pj:items-start pj:justify-center pj:bg-background/80 pj:p-3 pj:pt-[min(30dvh,12rem)] pj:backdrop-blur-[2px]',
        className,
      )}
    >
      <div className="pj:flex pj:max-w-sm pj:flex-col pj:gap-1.5 pj:rounded-lg pj:border pj:bg-surface-raised pj:p-4 pj:text-center pj:shadow-pop">
        <p className="pj:m-0 pj:text-sm pj:font-semibold pj:text-foreground">Viewer stopped</p>
        <p className="pj:m-0 pj:text-[13px] pj:text-muted-foreground">
          This page lost its connection, so it can't update or respond. Ask the agent to show the projection again, or reopen this page. It
          reconnects on its own if the viewer comes back.
        </p>
      </div>
    </div>
  )
}

/** What is compared, at the header's end: two named revisions as chips, short and in full on hover, or the choice in words. */
function Compared({state}: {state: ViewerState}) {
  const sides = state.sides
  if (!sides)
    return state.compared ? (
      <span
        className="pi-viewer-compared pi-viewer-text pj:max-w-[55%] pj:shrink-0 pj:truncate pj:text-muted-foreground"
        title={state.compared}
      >
        {state.compared}
      </span>
    ) : null
  const chip = (name: string, side: 'before' | 'after') => (
    <span
      data-side={side}
      title={name}
      className="pi-viewer-revision pi-viewer-text pj:min-w-0 pj:max-w-[32ch] pj:truncate pj:rounded-md pj:bg-muted pj:px-1.5 pj:text-xs pj:text-muted-foreground"
    >
      {name}
    </span>
  )
  return (
    <span className="pi-viewer-compared pj:flex pj:max-w-[55%] pj:shrink-0 pj:items-center pj:gap-1.5" aria-label={state.compared}>
      {sides.before != null && (
        <>
          {chip(sides.before, 'before')}
          <span aria-hidden="true" className="pi-viewer-text pj:shrink-0 pj:text-xs pj:text-muted-foreground">
            →
          </span>
        </>
      )}
      {chip(sides.after, 'after')}
    </span>
  )
}

/**
 * What a one-revision view adds at its toolbar's start (where a comparison's mode switch sits): the revision it shows,
 * a commit's short hash, when that isn't the working tree; else nothing, since the header already says what is shown.
 * The toolbar spans the page either way.
 */
export function ViewerShown({store}: {store: Store}) {
  const {state} = useSyncExternalStore(store.subscribe, store.get, store.get)
  const revision = state?.projection ? shownRevision(state) : undefined
  if (!revision) return null
  return (
    <span
      className="pi-viewer-shown pj:flex pj:h-8 pj:min-w-0 pj:max-w-[min(24rem,45vw)] pj:items-center pj:px-2 pj:text-xs pj:text-muted-foreground"
      title={`Revision ${state?.after}`}
    >
      <code className="pj:min-w-0 pj:truncate pj:font-mono">{revision}</code>
    </span>
  )
}

/** The revision a one-revision view shows, unless it is the working tree: a full commit hash shortened. */
export function shownRevision(state: ViewerState): string | undefined {
  const after = state.after ?? 'working-tree'
  if (after === 'working-tree') return undefined
  return /^[0-9a-f]{40}$/i.test(after) ? after.slice(0, 7) : after
}

/** The page before the agent shows a projection: the status line alone. The Inspector replaces it once mounted. */
export function mountWaiting(element: HTMLElement, store: Store, host: InspectorHost) {
  const holder = document.createElement('div')
  element.append(holder)
  const root = createRoot(holder)
  root.render(
    <InspectorHostProvider host={host}>
      <WaitingPage store={store} />
    </InspectorHostProvider>,
  )
  let removed = false
  return {
    remove() {
      if (removed) return
      removed = true
      root.unmount()
      holder.remove()
    },
  }
}

function WaitingPage({store}: {store: Store}) {
  const {status, stopped} = useSyncExternalStore(store.subscribe, store.get, store.get)
  return (
    <StartupShell>
      {stopped && <Stopped className="pj:fixed pj:inset-0" />}
      <p role="status" aria-live="polite" className="pi-viewer-idle pj:m-0 pj:text-center pj:text-sm pj:text-muted-foreground">
        {status}
      </p>
    </StartupShell>
  )
}
