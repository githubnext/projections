import {changeContextItems} from '@githubnext/projections-host'
import type {ProjectionController} from '@githubnext/projections-host'
import type {InspectorKeptResult, InspectorRunning, InspectorSummary} from '../control.js'
import type {ProjectionStatus} from '../shell/switcher.js'
import type {InspectorDefinitionList} from '../types.js'
import type {Marks} from './pairs.js'
import {resultsOf} from './revisions.js'
import type {RowState} from './revisions.js'
import type {Rows} from './use-extractions.js'

/** What the handle reads when a host calls it: the latest render's. */
export interface HandleState {
  definitions: InspectorDefinitionList | null
  projection: string
  marked: Marks
  showing: 'live' | 'artifact'
  before: string
  after: string | undefined
  error: string | null
  outcome: string
  rows: Rows
  definitionRevision: string
  switching: boolean
  /** What the shown pair's job is doing, if one runs. */
  running: InspectorRunning | undefined
  /** The renderer scenario shown, if any. */
  scenario: string | undefined
  /** The notices the view shows. */
  notices: readonly string[]
}

const titleOf = (state: HandleState, id: string) => state.definitions?.definitions.find(item => item.id === id)?.title ?? id

/** The shown pair's extractions, for a host to keep and restore (`initialResults`). */
export function keptResults({marked: shown, projection: id, rows: all}: HandleState): Record<string, InspectorKeptResult> {
  const kept: Record<string, InspectorKeptResult> = {}
  for (const ref of [shown.a, shown.b]) {
    const row = ref ? all[id]?.[ref] : undefined
    if (ref && row?.status === 'done' && row.document) {
      kept[ref] = {
        document: row.document,
        ...(row.jobId ? {job: row.jobId} : {}),
        ...(row.definition ? {definition: row.definition} : {}),
      }
    }
  }
  return kept
}

/** `rows` without `target`'s queued extractions outside `wanted`: those extracted before keep their extraction. */
export function withoutQueued(current: Rows, target: string, wanted: ReadonlySet<string | undefined>): Rows {
  const own = current[target]
  const dropped = Object.entries(own ?? {}).filter(([ref, row]) => row.status === 'queued' && !wanted.has(ref))
  if (!own || !dropped.length) return current
  const next: Record<string, RowState> = {...own}
  for (const [ref, row] of dropped) {
    if (row.document) next[ref] = {...row, status: 'done'}
    else delete next[ref]
  }
  return {...current, [target]: next}
}

/** What the Inspector shows, for a host: the projection, pair and status, the comparison's items and selection. */
export function inspectorSummary(
  state: HandleState,
  controller: ProjectionController | null,
  status: ProjectionStatus | undefined,
): InspectorSummary {
  const selected = controller?.selectedRow
  const changes: Record<string, number> = {}
  for (const row of controller?.rows ?? []) if (row.status) changes[row.status] = (changes[row.status] ?? 0) + 1
  const failures =
    state.showing === 'live' && state.projection
      ? [state.marked.a, state.marked.b].flatMap(ref => {
          const row = ref ? state.rows[state.projection]?.[ref] : undefined
          return ref && row?.status === 'failed' && row.error ? [{ref, message: row.error}] : []
        })
      : []
  return {
    source: state.showing === 'artifact' ? 'artifact' : 'live',
    ...(state.projection ? {projection: {id: state.projection, title: titleOf(state, state.projection)}} : {}),
    projections: (state.definitions?.definitions ?? []).map(item => ({id: item.id, title: item.title ?? item.id})),
    pair:
      state.showing === 'live'
        ? {...(state.marked.a ? {before: state.marked.a} : {}), ...(state.marked.b ? {after: state.marked.b} : {})}
        : {...(state.before ? {before: state.before} : {}), ...(state.after ? {after: state.after} : {})},
    // While a newly chosen pair extracts, the view still presents the one before: its counts aren't this pair's.
    status:
      status === 'running' || state.switching
        ? 'extracting'
        : status === 'failed' || status === 'ok' || status === 'trust'
          ? status
          : 'idle',
    ...(state.running ? {running: state.running} : {}),
    executionAuthorized: Boolean(state.definitions?.executionAuthorized),
    ...(controller && !state.switching
      ? {comparison: {compared: state.outcome === 'compared', rows: controller.rows.length, changes}}
      : {}),
    ...(controller && !state.switching ? {items: summaryItems(controller)} : {}),
    ...(selected
      ? {
          selection: {
            id: selected.id,
            label: selected.label,
            kind: selected.kind,
            ...(selected.status ? {status: selected.status} : {}),
          },
        }
      : {}),
    ...(state.error ? {error: state.error} : {}),
    ...(state.notices.length && !state.switching ? {notices: [...state.notices]} : {}),
    ...(state.showing === 'live' && state.projection && !state.switching
      ? {results: resultsOf(state.rows[state.projection], state.marked)}
      : {}),
    ...(state.showing === 'live' ? {definitionRevision: state.definitionRevision} : {}),
    ...(state.scenario ? {scenario: state.scenario} : {}),
    ...(failures.length ? {failures} : {}),
  }
}

/** The presented rows, changed ones first (identity changes too), at most 100, each change with its context. */
function summaryItems(controller: ProjectionController): NonNullable<InspectorSummary['items']> {
  const contextOf = changeContextItems(controller.rows, controller.subject)
  // A rename, split or merge is `unchanged` but is a change; its correspondence says so.
  const identity = (row: (typeof controller.rows)[number]) =>
    row.correspondence && row.correspondence !== 'exact' && row.correspondence !== 'none' ? row.correspondence : undefined
  const changed = (row: (typeof controller.rows)[number]) => Boolean((row.status && row.status !== 'unchanged') || identity(row))
  return [...controller.rows]
    .sort((a, b) => Number(!changed(a)) - Number(!changed(b)))
    .slice(0, 100)
    .map(row => {
      const context = contextOf(row)
      const correspondence = identity(row)
      return {
        id: row.id,
        label: row.label,
        kind: row.kind,
        ...(row.status ? {status: row.status} : {}),
        ...(correspondence ? {correspondence} : {}),
        ...(context ? {context} : {}),
      }
    })
}
