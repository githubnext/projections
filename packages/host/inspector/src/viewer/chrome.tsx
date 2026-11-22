import {useSyncExternalStore} from 'react'
import type {ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import {ProjectionsMark, cn} from '@githubnext/projections-host/ui/components'
import {InspectorHostProvider, useInspectorHost} from '../host.js'
import type {InspectorHost} from '../host.js'
import {StartupShell} from '../mount.js'
import type {SwitcherItem} from '../shell/switcher.js'
import type {ViewerState} from './state.js'
import {readPanePinned, setPanePinned, usePaneShown} from './pane.js'
import {paneFocusMachine} from './pane-focus.js'
import type {PaneFocus, PaneFocusEvent} from './pane-focus.js'
import {ViewerTitle} from './title.js'
import {usePaneRoom} from '@githubnext/projections-host'

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
  /** Something about the page itself, said in the status line while there is nothing else to say (an ignored theme). */
  notice?: string | undefined
  /** The notice's details, in the status line's tooltip. */
  noticeDetail?: string | undefined
  /** Whether the person pinned the projections pane (viewer/pane.tsx), remembered across reloads. */
  pinned: boolean
  /** Where focus is, and where it goes next, between the pane and the title's menu (pane-focus.ts). */
  focus: PaneFocus
}

/** A tiny store the header reads. */
export function createStore() {
  let snapshot: Snapshot = {
    state: undefined,
    status: 'Connecting…',
    stopped: false,
    projections: [],
    colorMode: 'light',
    pinned: readPanePinned(),
    focus: {kind: 'elsewhere'},
  }
  const listeners = new Set<() => void>()
  const set = (next: Partial<Snapshot>) => {
    if (Object.entries(next).every(([key, value]) => snapshot[key as keyof Snapshot] === value)) return
    snapshot = {...snapshot, ...next}
    for (const listener of listeners) listener()
  }
  return {
    get: () => snapshot,
    set,
    /** Moves focus between the pane and the menu (`paneFocusMachine`). */
    focus: (event: PaneFocusEvent) => {
      set({focus: paneFocusMachine.transition(snapshot.focus, event).state})
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
export type Store = ReturnType<typeof createStore>

/**
 * The one-line header: the Projections mark and the projection's title, then at its end the status line and what is
 * compared (unless the host's own surface already says, `InspectorHost.revisionsNamed`). The mark takes no more height than the text's cap (styles.css), so the header keeps its height. What is
 * compared, an outline pill (two for named revisions), keeps its words up to about half the row, each pill shortening
 * with an ellipsis and saying its name in full on hover; the title takes the rest, and shortens first. Its text is centred by cap height
 * (styles.css). The title is also the menu of the repository's projections (`onChoose`, title.tsx). A host's own
 * control (`end`) closes the row.
 */
export function ViewerHeader({store, end, onChoose}: {store: Store; end?: ReactNode; onChoose?: (projection: string) => void}) {
  const {state, status, stopped, projections, colorMode, choosing, failed, notice, noticeDetail, focus} = useSyncExternalStore(
    store.subscribe,
    store.get,
    store.get,
  )
  const shown = choosing ?? state?.projection ?? undefined
  const title = shown
    ? choosing
      ? (projections.find(item => item.id === choosing)?.title ?? choosing)
      : (state?.title ?? shown)
    : 'Projections'
  const line = failed ?? (status || notice)
  const noticed = !failed && !status && Boolean(notice)
  // A surface that already names the revisions (`InspectorHost.revisionsNamed`) isn't told them again.
  const named = useInspectorHost().revisionsNamed === true
  // With the projections pane pinned, the title is the title alone; the menu offers pinning where the pane fits.
  const paneRoom = usePaneRoom()
  const paneShown = usePaneShown(store, paneRoom)
  return (
    <header className="pi-viewer-header pj:relative pj:z-20 pj:flex pj:min-w-0 pj:shrink-0 pj:items-center pj:gap-3 pj:border-b pj:border-divider pj:bg-surface-header pj:px-3 pj:text-[13px]">
      <ProjectionsMark tone="two-tone" className="pi-viewer-mark pj:text-foreground" />
      <ViewerTitle
        title={title}
        current={shown}
        projections={projections}
        colorMode={colorMode}
        onChoose={stopped || paneShown ? undefined : onChoose}
        onPin={paneRoom && !stopped ? () => setPanePinned(store, true) : undefined}
        focus={focus.kind === 'toMenu'}
        onFocused={() => store.focus({type: 'taken'})}
        menuFocused={focus.kind === 'menu'}
        onMenuFocus={inside => store.focus({type: inside ? 'entered' : 'left', place: 'menu'})}
        // The pane that replaces the menu takes the focus the menu held.
        onMenuGone={lost => store.focus({type: 'gone', place: 'menu', lost, replaced: paneShown})}
      />
      {line && (
        <span
          role="status"
          aria-live="polite"
          title={noticed && noticeDetail ? `${line}: ${noticeDetail}` : line}
          className={cn(
            'pi-viewer-status pi-viewer-text pj:min-w-0 pj:max-w-[40%] pj:truncate pj:text-xs',
            stopped || failed || noticed ? 'pj:font-medium pj:text-foreground' : 'pj:text-muted-foreground',
          )}
        >
          {line}
        </span>
      )}
      {state?.projection && !named && <Compared state={state} />}
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

/**
 * An outline pill at the header's end: a 1px border, fully rounded, no fill, its muted text cut short with an ellipsis
 * and whole in its tooltip. Its box is a whole 20px, the text centred in it by cap height (styles.css).
 */
function Pill({className, title, children, ...rest}: {className: string; title: string; children: ReactNode; 'data-side'?: string}) {
  return (
    <span
      title={title}
      className={cn('pi-viewer-pill pj:min-w-0 pj:border pj:border-divider pj:text-xs pj:text-muted-foreground', className)}
      {...rest}
    >
      <span className="pi-viewer-text pj:min-w-0 pj:truncate">{children}</span>
    </span>
  )
}

/** What is compared, at the header's end: two named revisions as pills, short and in full on hover, or the choice in words. */
function Compared({state}: {state: ViewerState}) {
  const sides = state.sides
  if (!sides) {
    return state.compared ? (
      <Pill className="pi-viewer-compared pj:max-w-[55%] pj:shrink-0" title={state.compared}>
        {state.compared}
      </Pill>
    ) : null
  }
  const pill = (name: string, side: 'before' | 'after') => (
    <Pill className="pi-viewer-revision pj:max-w-[32ch]" title={name} data-side={side}>
      {name}
    </Pill>
  )
  return (
    <span className="pi-viewer-compared pj:flex pj:max-w-[55%] pj:shrink-0 pj:items-center pj:gap-1.5" aria-label={state.compared}>
      {sides.before !== undefined && sides.before !== null && (
        <>
          {pill(sides.before, 'before')}
          <span aria-hidden="true" className="pi-viewer-text pj:shrink-0 pj:text-xs pj:text-muted-foreground">
            →
          </span>
        </>
      )}
      {pill(sides.after, 'after')}
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
  return /^[0-9a-f]{40}$/iu.test(after) ? after.slice(0, 7) : after
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
  const {status, stopped, notice, noticeDetail} = useSyncExternalStore(store.subscribe, store.get, store.get)
  return (
    <StartupShell>
      {stopped && <Stopped className="pj:fixed pj:inset-0" />}
      <p role="status" aria-live="polite" className="pi-viewer-idle pj:m-0 pj:text-center pj:text-sm pj:text-muted-foreground">
        {status}
      </p>
      {notice && (
        <p className="pi-viewer-notice pj:m-0 pj:text-center pj:text-xs pj:text-muted-foreground" title={noticeDetail}>
          {notice}
        </p>
      )}
    </StartupShell>
  )
}
