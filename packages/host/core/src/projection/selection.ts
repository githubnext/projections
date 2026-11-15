import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {AnchorRect} from '@githubnext/projections-renderer-sdk/protocol'
import type {RendererFrame} from '../frame.js'
import type {Side} from '../modes.js'
import type {Row, ViewSubject} from '../model.js'
import {resolveTarget, rowTargets} from '../targets/target.js'
import type {placeAnnotations} from '../targets/annotations.js'
import type {ProjectionSelection, ProjectionTarget} from '../targets/target.js'
import type {Controllable} from './controllable.js'
import type {PaneKey, ProjectionAnchor, ProjectionController} from './types.js'

export type Anchors = Record<Side, {[id: string]: AnchorRect | null}>

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

export type SelectionInput = Pick<Controllable, 'latest' | 'request'> & {
  subject: ViewSubject
  rows: readonly Row[]
  selectedId: string | null
  placed: ReturnType<typeof placeAnnotations>
  anchors: Anchors
  frames: {readonly current: Record<Side, RendererFrame | null>}
}

/**
 * The selection: the selected row, the specific target chosen for it (a property, or one the host selected), and
 * selecting from renderers, annotations and targets; reports changes and anchors the selection on screen.
 */
export function useSelection({latest, request, subject, rows, selectedId, placed, anchors, frames}: SelectionInput) {
  // The specific target chosen for the selected row (a property, or one the host selected).
  const [pinned, setPinned] = useState<{rowId: string; target: ProjectionTarget} | null>(null)
  const selection = useMemo<ProjectionSelection | null>(() => {
    if (selectedId === null) return null
    const row = rows.find(candidate => candidate.id === selectedId)
    return {
      rowId: selectedId,
      targets: row ? rowTargets(row, subject) : [],
      ...(pinned?.rowId === selectedId ? {target: pinned.target} : {}),
    }
  }, [selectedId, rows, subject, pinned])

  useEffect(() => {
    if (latest.current.selectedId === undefined) latest.current.onSelectedIdChange?.(selectedId)
  }, [selectedId, latest])
  const selectionKey = JSON.stringify(selection)
  const reportedSelection = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (reportedSelection.current === undefined && selection === null) {
      reportedSelection.current = selectionKey
      return
    }
    if (reportedSelection.current === selectionKey) return
    reportedSelection.current = selectionKey
    latest.current.onSelectionChange?.(JSON.parse(selectionKey) as ProjectionSelection | null)
  }, [selectionKey, selection, latest])

  const selectRow = useCallback(
    (id: string | null, target?: ProjectionTarget) => {
      setPinned(id !== null && target ? {rowId: id, target} : null)
      request('selectedId', id)
    },
    [request],
  )
  const resolve = useCallback((target: ProjectionTarget) => resolveTarget(subject, rows, target), [subject, rows])
  const selectFrom = useCallback(
    (pane: PaneKey, id: string | null, path?: string) => {
      if (id === null || path === undefined) {
        selectRow(id)
        return
      }
      const row = rows.find(candidate => candidate.id === id)
      const targets = row ? rowTargets(row, subject) : []
      const preferred = pane === 'before' ? 'before' : 'after'
      const target = targets.find(item => item.side === preferred) ?? targets[0]
      selectRow(id, target ? {...target, path} : undefined)
    },
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
  const selectedPath = useMemo<Record<PaneKey, string | undefined>>(() => {
    const target = selection?.target
    const path = target?.path
    return {main: path, before: target?.side === 'before' ? path : undefined, after: target?.side === 'after' ? path : undefined}
  }, [selection])
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
    if (resolution.status === 'present') selectRow(resolution.rowId, target)
    else if (resolution.rowId !== undefined) {
      const {path: _path, ...item} = target
      selectRow(resolution.rowId, item)
    }
    return resolution
  }
  return {setPinned, selection, selectRow, resolve, selectFrom, activateAnnotation, selectedPath, anchorFor, selectTarget}
}
