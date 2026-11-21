import {useCallback, useEffect, useMemo, useState} from 'react'
import type {AnchorRect} from '@githubnext/projections-renderer-sdk/protocol'
import type {RendererFrame} from '../frame.js'
import type {Side} from '../modes.js'
import type {Row, ViewSubject} from '../model.js'
import {resolveTarget, rowTargets} from '../targets/target.js'
import type {placeAnnotations} from '../targets/annotations.js'
import type {ProjectionSelection, ProjectionTarget} from '../targets/target.js'
import type {Controllable} from './controllable.js'
import type {Interaction, InteractionEvent, Pinned} from './interaction.js'
import type {PaneKey, ProjectionAnchor, ProjectionController} from './types.js'

/** Where a renderer's anchor for an item shows on screen, clipped to its frame, or `null` when it doesn't show. */
function visibleAnchor(rect: AnchorRect, iframe: HTMLIFrameElement, side: Side): ProjectionAnchor | null {
  const box = iframe.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  const left = box.left + iframe.clientLeft,
    top = box.top + iframe.clientTop
  const x = Math.max(left + rect.x, box.left),
    y = Math.max(top + rect.y, box.top)
  const right = Math.min(left + rect.x + rect.width, box.right),
    bottom = Math.min(top + rect.y + rect.height, box.bottom)
  if (right - x < 1 || bottom - y < 1) return null
  return {x, y, width: right - x, height: bottom - y, side}
}

/** The selection: the selected row, its targets and the target chosen for it, if it is still the pinned row's. */
export function selectionOf(
  selectedId: string | null,
  rows: readonly Row[],
  subject: ViewSubject,
  pinned: Pinned,
): ProjectionSelection | null {
  if (selectedId === null) return null
  const row = rows.find(candidate => candidate.id === selectedId)
  return {
    rowId: selectedId,
    targets: row ? rowTargets(row, subject) : [],
    ...(pinned?.rowId === selectedId ? {target: pinned.target} : {}),
  }
}

/** The path each pane shows selected: the chosen target's, on its side. */
export function selectedPaths(selection: ProjectionSelection | null): Record<PaneKey, string | undefined> {
  const target = selection?.target
  const path = target?.path
  return {main: path, before: target?.side === 'before' ? path : undefined, after: target?.side === 'after' ? path : undefined}
}

/**
 * The target a renderer's selection chooses: with a path, the row's target on the pane's side (the after side for the
 * main pane), else its first, at that path; without one, none.
 */
export function selectedTarget(
  pane: PaneKey,
  rowId: string | null,
  path: string | undefined,
  rows: readonly Row[],
  subject: ViewSubject,
): ProjectionTarget | undefined {
  if (rowId === null || path === undefined) return undefined
  const row = rows.find(candidate => candidate.id === rowId)
  const targets = row ? rowTargets(row, subject) : []
  const preferred = pane === 'before' ? 'before' : 'after'
  const target = targets.find(item => item.side === preferred) ?? targets[0]
  return target ? {...target, path} : undefined
}

/**
 * What selecting a target selects, by how it resolves: the target itself when present, its row without the path when
 * only the row is, else nothing.
 */
export function targetSelection(
  target: ProjectionTarget,
  resolution: ReturnType<typeof resolveTarget>,
): {rowId: string; target: ProjectionTarget} | undefined {
  if (resolution.status === 'present') return {rowId: resolution.rowId, target}
  if (resolution.rowId === undefined) return undefined
  const {path: _path, ...item} = target
  return {rowId: resolution.rowId, target: item}
}

/**
 * Reports selection changes, compared by value, from the first selection on: returns the selection to report, or
 * `undefined` when there is nothing new.
 */
export function createSelectionReport(): (selection: ProjectionSelection | null) => ProjectionSelection | null | undefined {
  let reported: string | undefined
  return selection => {
    const key = JSON.stringify(selection)
    if (reported === undefined && selection === null) {
      reported = key
      return undefined
    }
    if (reported === key) return undefined
    reported = key
    return JSON.parse(key) as ProjectionSelection | null
  }
}

export type SelectionInput = Pick<Controllable, 'latest' | 'request'> & {
  subject: ViewSubject
  rows: readonly Row[]
  selectedId: string | null
  placed: ReturnType<typeof placeAnnotations>
  interaction: Interaction
  send: (event: InteractionEvent) => void
  frames: {readonly current: Record<Side, RendererFrame | null>}
}

/**
 * The selection: the selected row, the specific target chosen for it (a property, or one the host selected), and
 * selecting from renderers, annotations and targets; reports changes and anchors the selection on screen.
 */
export function useSelection({latest, request, subject, rows, selectedId, placed, interaction, send, frames}: SelectionInput) {
  const {pinned, anchors} = interaction
  const selection = useMemo(() => selectionOf(selectedId, rows, subject, pinned), [selectedId, rows, subject, pinned])

  useEffect(() => {
    if (latest.current.selectedId === undefined) latest.current.onSelectedIdChange?.(selectedId)
  }, [selectedId, latest])
  const [report] = useState(createSelectionReport)
  useEffect(() => {
    const reported = report(selection)
    if (reported !== undefined) latest.current.onSelectionChange?.(reported)
  }, [selection, report, latest])

  const selectRow = useCallback(
    (id: string | null, target?: ProjectionTarget) => {
      send({type: 'selected', rowId: id, target})
      request('selectedId', id)
    },
    [request, send],
  )
  const resolve = useCallback((target: ProjectionTarget) => resolveTarget(subject, rows, target), [subject, rows])
  const selectFrom = useCallback(
    (pane: PaneKey, id: string | null, path?: string) => selectRow(id, selectedTarget(pane, id, path, rows, subject)),
    [rows, subject, selectRow],
  )
  const activateAnnotation = useCallback(
    (rowId: string) => {
      selectRow(rowId)
      const row = rows.find(candidate => candidate.id === rowId)
      latest.current.onAnnotationActivate?.({
        rowId,
        targets: row ? rowTargets(row, subject) : [],
        annotations: placed.byRow.get(rowId) ?? [],
      })
    },
    [rows, subject, placed, selectRow, latest],
  )
  const selectedPath = useMemo(() => selectedPaths(selection), [selection])
  const anchorFor = useCallback(
    (rowId: string | null = selectedId, side?: Side): ProjectionAnchor | null => {
      if (rowId === null) return null
      const preferred = side ?? (selection?.rowId === rowId ? selection.target?.side : undefined)
      const order: Side[] = preferred ? [preferred, preferred === 'before' ? 'after' : 'before'] : ['after', 'before']
      for (const pane of order) {
        const rect = anchors[pane][rowId]
        const iframe = frames.current[pane]?.iframe
        if (!rect || !iframe?.isConnected) continue
        const anchor = visibleAnchor(rect, iframe, pane)
        if (anchor) return anchor
      }
      return null
    },
    [anchors, selectedId, selection, frames],
  )
  const selectTarget: ProjectionController['selectTarget'] = target => {
    const resolution = resolve(target)
    const chosen = targetSelection(target, resolution)
    if (chosen) selectRow(chosen.rowId, chosen.target)
    return resolution
  }
  return {selection, selectRow, resolve, selectFrom, activateAnnotation, selectedPath, anchorFor, selectTarget}
}
