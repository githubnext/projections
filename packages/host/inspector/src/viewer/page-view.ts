import {generatedForm, rowDetails} from '@githubnext/projections-host'
import type {InspectorHandle} from '../control.js'

/** What the page presents, for the agent (`PageView` in the VS Code current view model). */
export function pageView(handle: InspectorHandle) {
  const summary = handle.summary()
  const view = handle.view()
  return {
    status: summary.status,
    ...(summary.error ? {error: summary.error} : {}),
    ...(summary.notices?.length ? {notices: summary.notices} : {}),
    ...(summary.comparison
      ? {compared: summary.comparison.compared, rows: summary.comparison.rows, changes: summary.comparison.changes}
      : {}),
    ...(summary.items ? {items: summary.items} : {}),
    ...(summary.selection ? {selection: summary.selection} : {}),
    ...(view
      ? {
          figures: view.summary.map(figure => ({
            noun: figure.noun,
            count: figure.count,
            ...(view.comparing ? {added: figure.added, removed: figure.removed, modified: figure.modified} : {}),
            ...(figure.description ? {description: figure.description} : {}),
          })),
          ...(view.comparing ? {mode: view.mode, modes: [...view.availableModes]} : {}),
          showAs: view.renderer ? 'renderer' : 'table',
          changesOnly: view.changesOnly,
          ...(view.variation ? {variation: view.variation} : {}),
          ...selectedGenerated(view),
        }
      : {}),
  }
}

/** The selected item's generated values, for the agent: names and how each differs. */
function selectedGenerated(view: NonNullable<ReturnType<InspectorHandle['view']>>) {
  const row = view.selectedId === null ? undefined : view.rows.find(candidate => candidate.id === view.selectedId)
  if (!row) return {}
  const generated = rowDetails(view.subject, row, view.rows).generated.map(field => {
    const form = generatedForm(field)
    return {name: field.name, form: form.form, ...(form.words ? {words: form.words} : {})}
  })
  return generated.length ? {generated} : {}
}
