// What the page presents now, for the agent's current view (`PageView`) and the tab's report of its view.
import {generatedForm, rowDetails} from '@githubnext/projections-host-vscode'
import type {InspectorHandle} from '@githubnext/projections-inspector/mount'
import type {PageView} from '../current-view/types.js'
import {showAs} from './tab-state.js'

export type View = NonNullable<ReturnType<InspectorHandle['view']>>

/** How the view shows its projection: as the editor's `…` menu chose, else its renderer, else a table. */
export const shownAs = (view: View) => showAs.get() ?? (view.renderer ? 'renderer' : 'table')

/** What the page presents now, for the agent (`PageView`): the items, selection, summary bar figures and mode. */
export function currentView(inspector: InspectorHandle): PageView {
  const summary = inspector.summary()
  const view = inspector.view()
  return {
    status: summary.status,
    ...(summary.error ? {error: summary.error} : {}),
    ...(summary.notices?.length !== undefined && summary.notices.length > 0 ? {notices: summary.notices} : {}),
    ...(summary.comparison
      ? {compared: summary.comparison.compared, rows: summary.comparison.rows, changes: summary.comparison.changes}
      : {}),
    ...(summary.items ? {items: summary.items} : {}),
    ...(summary.selection ? {selection: summary.selection} : {}),
    ...(view ? presented(view) : {}),
  }
}

/** What the projection view presents: its summary bar figures, mode, how it shows, selection and size. */
function presented(view: View): Partial<PageView> {
  return {
    figures: view.summary.map(figure => ({
      noun: figure.noun,
      count: figure.count,
      ...(view.comparing ? {added: figure.added, removed: figure.removed, modified: figure.modified} : {}),
      ...(figure.description ? {description: figure.description} : {}),
    })),
    ...(view.comparing ? {mode: view.mode, modes: [...view.availableModes]} : {}),
    showAs: shownAs(view),
    changesOnly: view.changesOnly,
    ...(view.variation ? {variation: view.variation} : {}),
    ...selectedGenerated(view),
    ...(view.comparing ? {progress: view.progress} : {}),
    colorMode: view.colorMode,
    width: innerWidth,
    height: innerHeight,
  }
}

/** The selected item's generated values, for the agent: names and how each differs. */
function selectedGenerated(view: View): Pick<PageView, 'generated'> {
  const row = view.selectedId === null ? undefined : view.rows.find(candidate => candidate.id === view.selectedId)
  if (!row) return {}
  const generated = rowDetails(view.subject, row, view.rows).generated.map(field => {
    const form = generatedForm(field)
    return {name: field.name, form: form.form, ...(form.words ? {words: form.words} : {})}
  })
  return generated.length ? {generated} : {}
}
