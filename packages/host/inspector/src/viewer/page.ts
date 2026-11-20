import type {InspectorHandle} from '../control.js'
import type {ViewerState} from './state.js'

type View = NonNullable<ReturnType<InspectorHandle['view']>>

/** Whether the state's selection and mode took. */
export interface Applied {
  generation: number
  selection: boolean
  mode: boolean
  found: boolean
  /** Latches once the page shows the state; after that, a difference is the person's doing, and is reported. */
  settled: boolean
}

/** What a viewer page has of the view state, and what it has applied of it. */
export interface ViewerPage {
  /** The page's ID, which its reports carry. */
  id: string
  state: ViewerState | undefined
  handle: InspectorHandle | null
  /** What this page has applied of the state: its pair, scenario and refresh. */
  shown: {key: string; refresh: number} | undefined
  applied: Applied
}

/**
 * Whether the state is the echo of one of the page's own reports, as the server says. Its selection and mode are what
 * the page already showed, and applying them would undo what the person has done since (a mode clicked before the echo
 * arrived).
 */
export const echoes = (page: ViewerPage, state: ViewerState) => state.reportedBy === page.id

export const pairKey = (value: ViewerState) =>
  JSON.stringify([value.projection, value.before ?? null, value.after ?? null, value.scenario ?? null])

export function unapplied(generation: number): Applied {
  return {generation, selection: false, mode: false, found: false, settled: false}
}

/** Latches `settled` once the applied state is what the page shows. */
export function settle(page: ViewerPage, view: View | null) {
  const {state, applied} = page
  if (applied.settled || !state?.projection || applied.generation !== state.generation || !applied.selection || !applied.mode) return
  const mode = state.mode
  // An echo of the page's own report is shown, whatever the person has changed since: that change is reported next.
  const modeShown = echoes(page, state) || !mode || !view?.comparing || !view.availableModes.includes(mode as never) || view.mode === mode
  const selectionShown = !applied.found || (view?.selectedRow?.id ?? null) === (state.selection ?? null)
  applied.settled = modeShown && selectionShown
}

/**
 * The page's random ID, which its viewer counts open pages by. Not `crypto.randomUUID`, which only a secure context
 * has: a page framed by an app whose own document isn't one (a custom scheme, plain http) is not, though its own
 * loopback origin is. `getRandomValues` works in every context.
 */
export function pageId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Marks the document `data-projections-viewer="ready"` once the page shows the state settled (`projections view
 * screenshot --page` waits for it), `busy` until then.
 */
export function markReady(viewer: ViewerPage, handle: InspectorHandle, build: string | undefined) {
  const status = handle.summary().status
  const ready = viewer.applied.settled && build !== 'building' && (status === 'ok' || status === 'failed' || status === 'trust')
  const mark = ready ? 'ready' : 'busy'
  if (document.documentElement.dataset.projectionsViewer !== mark) document.documentElement.dataset.projectionsViewer = mark
}
