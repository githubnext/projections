import type {InspectorHandle, InspectorSummary} from '../control.js'
import {echoes, pairKey, unapplied} from './page.js'
import type {Applied, ViewerPage} from './page.js'
import type {ViewerState} from './state.js'

type View = NonNullable<ReturnType<InspectorHandle['view']>>

/** Shows the state's pair or scenario, or refreshes it when only the refresh changed. */
function showPair(page: ViewerPage, state: ViewerState, projection: string, handle: InspectorHandle) {
  const key = pairKey(state)
  const shown = page.shown
  if (shown?.key !== key) {
    // Another projection is selected once the runner's definitions have loaded: until then it isn't known.
    const summary = handle.summary()
    if (summary.projection?.id !== projection && !summary.projections.some(item => item.id === projection)) return
    if (state.scenario) {
      if (summary.projection?.id !== projection) handle.selectProjection(projection)
      handle.showScenario(state.scenario)
    } else
      handle.setPair({
        projection,
        after: state.after ?? 'working-tree',
        ...(state.before ? {before: state.before} : {}),
      })
    page.shown = {key, refresh: state.refresh}
  } else if (shown.refresh !== state.refresh) {
    shown.refresh = state.refresh
    handle.refresh()
  }
}

/** The mode and selection apply to the pair as shown: extracted, compared, and the renderer's modes known. */
function shows(view: View | null, state: ViewerState, summary: InspectorSummary): view is View {
  const pair = summary.pair
  return Boolean(
    view &&
    summary.status === 'ok' &&
    (state.scenario
      ? summary.scenario === state.scenario
      : (pair.before ?? null) === (state.before ?? null) && pair.after === (state.after ?? 'working-tree')) &&
    (!state.before || (summary.comparison?.compared && view.comparing && view.modesKnown)),
  )
}

function applyMode(applied: Applied, state: ViewerState, view: View, echo: boolean) {
  const mode = state.mode
  if (mode && !echo && view.comparing && view.availableModes.includes(mode as never) && view.mode !== mode) view.setMode(mode as never)
  applied.mode = true
}

function applySelection(applied: Applied, state: ViewerState, handle: InspectorHandle, view: View, echo: boolean) {
  const selection = state.selection ?? null
  if (echo) applied.selection = true
  else if ((view.selectedRow?.id ?? null) === selection || handle.selectEntity(selection)) applied.selection = applied.found = true
  // An entity the view doesn't present yet is selected once it does; one it never presents stays unselected.
  else if (view.rows.length) applied.selection = true
}

/** Applies the state through the handle: the pair or scenario, a refresh, then the mode and selection once shown. */
export function apply(page: ViewerPage) {
  const {state, handle} = page
  if (!state?.projection || !handle) return
  showPair(page, state, state.projection, handle)
  if (page.applied.generation !== state.generation) page.applied = unapplied(state.generation)
  const applied = page.applied
  const summary = handle.summary()
  if (summary.status === 'failed' || summary.status === 'trust') {
    applied.mode = applied.selection = true
    return
  }
  const view = handle.view()
  if (!shows(view, state, summary)) return
  // The echo of the page's own report says what the page already shows, or showed before the person changed it again.
  const echo = echoes(page, state)
  if (!applied.mode) applyMode(applied, state, view, echo)
  if (!applied.selection) applySelection(applied, state, handle, view, echo)
}
