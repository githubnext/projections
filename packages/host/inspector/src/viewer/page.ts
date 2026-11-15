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
  state: ViewerState | undefined
  handle: InspectorHandle | null
  /** What this page has applied of the state: its pair, scenario and refresh. */
  shown: {key: string; refresh: number} | undefined
  applied: Applied
  /**
   * The selection and mode this page last reported, at the state's generation then. The next generation with them is
   * its own report's echo, which must not undo what the person has done since (a mode clicked before the echo arrives).
   */
  reported: {generation: number; selection: string | null; mode?: string} | undefined
}

/** Whether the state is the echo of the page's own last report. */
export const echoes = (page: ViewerPage, state: ViewerState) =>
  page.reported !== undefined && state.generation === page.reported.generation + 1

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
