import {useEffect, useLayoutEffect, useRef, useSyncExternalStore} from 'react'
import {usePaneRoom} from '@githubnext/projections-host'
import {ProjectionsPane} from '@githubnext/projections-host/ui'
import {StatusDot} from '../shell/switcher.js'
import type {Store} from './chrome.js'

/** Where the viewer keeps whether its projections pane is pinned, across reloads. */
export const panePinnedKey = 'projections:pane-pinned:viewer'

/** Whether the viewer's pane was left pinned. Storage that throws (a sandboxed frame) says it wasn't. */
export function readPanePinned(): boolean {
  try {
    const storage = globalThis.localStorage as Storage | undefined
    return storage?.getItem(panePinnedKey) === 'true'
  } catch {
    return false
  }
}

/** Pins or closes the viewer's pane, and remembers it; `focus` is where focus goes (the pane, or back to the menu). */
export function setPanePinned(store: Store, pinned: boolean): void {
  store.set({pinned})
  store.focus({type: pinned ? 'pinned' : 'closed'})
  try {
    const storage = globalThis.localStorage as Storage | undefined
    if (pinned) storage?.setItem(panePinnedKey, 'true')
    else storage?.removeItem(panePinnedKey)
  } catch {
    // Kept for this page only.
  }
}

/**
 * Whether the viewer shows its pane: pinned, with more than one projection, `room` for it (`usePaneRoom`, measured
 * once by the caller), and its server answering.
 */
export function usePaneShown(store: Store, room: boolean): boolean {
  const {pinned, projections, stopped} = useSyncExternalStore(store.subscribe, store.get, store.get)
  return pinned && room && projections.length > 1 && !stopped
}

/**
 * The viewer's pinned projections pane (`ProjectionsPane`), at the start of the page under its header: the
 * repository's projections, each with its ID and status, the shown one current. Choosing one shows it as the title's
 * menu does; closing it returns to the menu.
 */
export function ViewerPane({store, onChoose}: {store: Store; onChoose: (projection: string) => void}) {
  const {state, choosing, projections, focus, stopped} = useSyncExternalStore(store.subscribe, store.get, store.get)
  const shown = usePaneShown(store, usePaneRoom())
  // Shown while focus waits for it, the pane takes it (`autoFocus`), then says so: once, not again as it comes back.
  useEffect(() => {
    if (shown && focus.kind === 'toPane') store.focus({type: 'taken'})
  }, [shown, focus.kind, store])
  // A pane that goes away while it holds focus (the page narrowing below its room) hands focus to the title's menu,
  // which takes its place, where that menu is there to take it: not while the server is gone, nor with one projection.
  const pane = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (shown || focus.kind !== 'pane') return
    const lost = !document.activeElement || document.activeElement === document.body
    store.focus({type: 'gone', place: 'pane', lost, replaced: !stopped && projections.length > 1})
  }, [shown, focus.kind, stopped, projections.length, store])
  if (!shown) return null
  return (
    <div
      ref={pane}
      className="pi-viewer-pane-slot pj:contents"
      onFocus={() => store.focus({type: 'entered', place: 'pane'})}
      onBlur={event => {
        if (!pane.current?.contains(event.relatedTarget)) store.focus({type: 'left', place: 'pane'})
      }}
    >
      <ProjectionsPane
        className="pi-viewer-pane"
        items={projections.map(item => ({
          id: item.id,
          title: item.title,
          detail: <code className="pj:font-mono pj:text-[11px]">{item.id}</code>,
          status: <StatusDot status={item.status} />,
        }))}
        current={choosing ?? state?.projection ?? undefined}
        onChoose={onChoose}
        onClose={() => setPanePinned(store, false)}
        autoFocus={focus.kind === 'toPane'}
      />
    </div>
  )
}
