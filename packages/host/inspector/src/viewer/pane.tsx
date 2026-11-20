import {useEffect, useSyncExternalStore} from 'react'
import {ProjectionsPane, usePaneRoom} from '@githubnext/projections-host/ui'
import {StatusDot} from '../shell/switcher.js'
import type {Store} from './chrome.js'

/** Where the viewer keeps whether its projections pane is pinned, across reloads. */
export const panePinnedKey = 'projections:pane-pinned:viewer'

/** Whether the viewer's pane was left pinned. Storage that throws (a sandboxed frame) says it wasn't. */
export function readPanePinned(): boolean {
  try {
    return globalThis.localStorage?.getItem(panePinnedKey) === 'true'
  } catch {
    return false
  }
}

/** Pins or closes the viewer's pane, and remembers it; `focus` is where focus goes (the pane, or back to the menu). */
export function setPanePinned(store: Store, pinned: boolean): void {
  store.set({pinned, paneFocus: pinned ? 'pane' : 'menu'})
  try {
    if (pinned) globalThis.localStorage?.setItem(panePinnedKey, 'true')
    else globalThis.localStorage?.removeItem(panePinnedKey)
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
  const {state, choosing, projections, paneFocus} = useSyncExternalStore(store.subscribe, store.get, store.get)
  const shown = usePaneShown(store, usePaneRoom())
  // The pane takes focus once, when pinned: not again when it comes back as the page widens.
  useEffect(() => {
    if (shown && paneFocus === 'pane') store.set({paneFocus: undefined})
  }, [shown, paneFocus, store])
  if (!shown) return null
  return (
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
      autoFocus={paneFocus === 'pane'}
    />
  )
}
