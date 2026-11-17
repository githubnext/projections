// A projection tab's reports to the extension: its summary and view (for the side bar, status bar and title actions)
// when they change, and its new results, which the extension keeps to present again if the page is dropped while hidden.
import type {InspectorHandle} from '@githubnext/projections-inspector/mount'
import {hostTag} from '../protocol.js'
import type {TabView} from '../protocol.js'
import {post} from './host.js'
import {shownAs} from './page-view.js'
import type {View} from './page-view.js'
import {appliedSwitch, keep, saved, tabState} from './tab-state.js'
import {shownChoice} from './tab-pair.js'
import {reducedMotion} from './theme.js'

type Summary = ReturnType<InspectorHandle['summary']>

/** Restores the changes-only and selection the tab kept, once its view is shown. */
function restoreView(view: View) {
  if (tabState.changesOnly !== undefined) view.setChangesOnly(tabState.changesOnly)
  if (tabState.selection && view.rows.some(row => row.id === tabState.selection)) view.select(tabState.selection)
}

/** The view as the title actions read it. */
function tabView(view: View): TabView {
  return {
    mode: view.mode,
    modes: [...view.availableModes],
    playing: view.playing,
    showAs: shownAs(view),
    changesOnly: view.changesOnly,
    zoom: view.controls.filter(control => control.type === 'action' && control.id.startsWith('zoom-')).map(control => control.id),
  }
}

/** The tab's summary report, as JSON: what it shows, its status and results, and its view. */
function summaryText(summary: Summary, view: View | null): string {
  const shown = view ? tabView(view) : undefined
  const shownSwitch = appliedSwitch()
  return JSON.stringify({
    projection: summary.projection?.id,
    pair: summary.pair,
    status: summary.status,
    // What its job is doing, for the status bar item's spinner, and whether the page moves less, for that spinner too.
    running: summary.running,
    reducedMotion: reducedMotion() || undefined,
    comparison: summary.comparison,
    error: summary.error,
    results: summary.results,
    definitionRevision: summary.definitionRevision,
    ...(shownSwitch === undefined ? {} : {generation: shownSwitch}),
    ...(shown ? {view: shown} : {}),
  })
}

/**
 * A projection tab reports its summary and view (for the side bar, status bar and title actions) when they change,
 * keeps its view with `setState`, and restores its selection, changes-only and comparison mode once shown.
 */
export function reportTab(current: () => InspectorHandle | null) {
  let reported = ''
  let kept = ''
  let restored = false
  /** A new result (its jobs changed): the extension keeps it, to present again if the page is dropped while hidden. */
  const keepResults = (handle: InspectorHandle, summary: Summary) => {
    const jobs = JSON.stringify(summary.results ?? {})
    if (summary.status !== 'ok' || !summary.pair.after || jobs === kept) return
    const results = handle.results()
    const refs = [summary.pair.before, summary.pair.after].filter((ref): ref is string => Boolean(ref))
    if (!refs.every(ref => results[ref])) return
    kept = jobs
    post({
      tag: hostTag,
      op: 'results',
      pair: {...(summary.pair.before ? {before: summary.pair.before} : {}), after: summary.pair.after},
      results,
    })
  }
  let openedPull: string | undefined
  setInterval(() => {
    const handle = current()
    if (!handle) return
    const view = handle.view()
    if (view && !restored) {
      restored = true
      restoreView(view)
    }
    // A pull request opens on its diff, as Files changed does (in the Changes scope, the view's default), unless the tab
    // came back with a mode of its own.
    const choice = shownChoice()
    if (view?.comparing && view.modesKnown && choice?.startsWith('pr:') && !saved.mode && openedPull !== choice) {
      openedPull = choice
      if (view.availableModes.includes('diff')) view.setMode('diff')
    }
    if (view) keep({mode: view.mode, changesOnly: view.comparing ? view.changesOnly : undefined, selection: view.selectedId ?? undefined})
    const summary = handle.summary()
    const text = summaryText(summary, view)
    if (text === reported) return
    reported = text
    keepResults(handle, summary)
    post({tag: hostTag, op: 'summary', summary: JSON.parse(text)})
  }, 500)
}
