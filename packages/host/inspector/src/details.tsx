import {useSyncExternalStore} from 'react'
import type {ProjectionController} from '@githubnext/projections-host'
import {RawDetails} from '@githubnext/projections-host/ui'
import {MousePointerClick} from 'lucide-react'

/**
 * The presented view's controller, for the docked Details panel beside it: the view hands it over through its
 * `controllerRef` (a callback ref, `set`) on every render, and the panel subscribes. Only a new controller notifies,
 * so the view re-rendering never re-renders the Inspector.
 */
export interface ControllerStore {
  set: (controller: ProjectionController | null) => void
  subscribe: (listener: () => void) => () => void
  get: () => ProjectionController | null
}

export function createControllerStore(): ControllerStore {
  let current: ProjectionController | null = null
  const listeners = new Set<() => void>()
  return {
    set(controller) {
      if (controller === current) return
      current = controller
      // A ref is cleared before each new handle; only the handle is news. An unmounted view is noticed on the
      // Inspector's next render, which the change that unmounted it causes.
      if (controller) for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get: () => current,
  }
}

/**
 * The docked Details panel's content: the raw details of the selection in the presented view (its identity, kind
 * and change, each side's item with its confidence, all its `data` and its evidence), for authors. It stays open and
 * follows the selection; with nothing selected it says how to choose something.
 */
export function DetailsDock({
  store,
  onOpen,
  beforeLabel,
  afterLabel,
}: {
  store: ControllerStore
  onOpen?: ((path: string, line?: number) => void) | undefined
  beforeLabel: string
  afterLabel: string
}) {
  const projection = useSyncExternalStore(store.subscribe, store.get, store.get)
  const row = projection?.selectedRow
  if (!projection || !row)
    return (
      <div className="pi-details-empty pj:flex pj:flex-col pj:items-center pj:gap-2 pj:px-4 pj:py-8 pj:text-center pj:text-xs pj:text-muted-foreground">
        <MousePointerClick aria-hidden="true" className="pj:size-5" />
        <p>
          {projection
            ? 'Select an entity or relationship in the view to see its identity, kind, data and evidence.'
            : 'Nothing is presented yet.'}
        </p>
      </div>
    )
  return (
    <div className="pi-details-dock pj:flex pj:min-w-0 pj:flex-col">
      <RawDetails projection={projection} onOpen={onOpen} beforeLabel={beforeLabel} afterLabel={afterLabel} />
    </div>
  )
}
