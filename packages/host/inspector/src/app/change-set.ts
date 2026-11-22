import type {InspectorWorkspaceChanges} from '../types.js'
import {workingTree, type RowState} from './revisions.js'

type Versions = Record<string, number>
type Rows = Record<string, Record<string, RowState>>

/** What a working-tree change (`GET /api/changes`) touched; an incomplete one may have touched anything. */
export function changeSet({changes, complete}: InspectorWorkspaceChanges) {
  const changed = (kind: string) => !complete || changes.includes(kind)
  const changedPart = (part: string) => !complete || changes.some(change => change.startsWith(`${part}:`))
  // A change to a projection's code (its definition or extractor) makes every extraction of it stale; a change to the
  // working tree's files, its working-tree extraction.
  const code = (id: string) => changed('definitions') || changed(`extractor:${id}`)
  // The working tree's definition's digest covers its renderer's and comparator's files too: an extraction that applied
  // it can't be compared with one taken after they changed, so it isn't presented again.
  const digest = (id: string, definition: string | undefined) =>
    definition === workingTree && (changed(`renderer:${id}`) || changed(`comparator:${id}`))
  const stale = (id: string, ref: string, definition: string | undefined) =>
    code(id) || digest(id, definition) || (ref === workingTree && changed('working-tree'))
  return {changes, complete, changed, changedPart, code, stale}
}
export type ChangeSet = ReturnType<typeof changeSet>

/** Bumps the renderer version of each projection whose renderer changed (every one shown, when unsure). */
export function bumpedRenderers(versions: Versions, set: ChangeSet, rows: Rows): Versions {
  const next = {...versions}
  for (const change of set.complete ? set.changes : Object.keys(rows).map(id => `renderer:${id}`)) {
    if (change.startsWith('renderer:')) next[change.slice('renderer:'.length)] = (next[change.slice('renderer:'.length)] ?? 0) + 1
  }
  return next
}

/** Bumps the scenario version of each projection whose scenarios (or the code they're made with) changed. */
export function bumpedScenarios(versions: Versions, set: ChangeSet, projection: string): Versions {
  const next = {...versions}
  for (const id of new Set([projection, ...Object.keys(versions)])) {
    if (set.changed('definitions') || set.changed(`scenarios:${id}`) || set.changed(`extractor:${id}`)) next[id] = (next[id] ?? 0) + 1
  }
  return next
}

/** `rows` without stale extractions, except the shown pair's (`kept`), which stay shown until new ones arrive. */
export function withoutStale(rows: Rows, set: ChangeSet, projection: string, kept: readonly string[]): Rows {
  const next = {...rows}
  for (const id of Object.keys(rows)) {
    const keep = id === projection ? kept : []
    const dropped = Object.keys(rows[id]!).filter(ref => !keep.includes(ref) && set.stale(id, ref, rows[id]![ref]?.definition))
    if (dropped.length) next[id] = Object.fromEntries(Object.entries(rows[id]!).filter(([ref]) => !dropped.includes(ref)))
  }
  return next
}
