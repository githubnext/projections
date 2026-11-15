import {useMemo} from 'react'
import type {AnnotationMark, ControlValue, FilterPayload} from '@githubnext/projections-renderer-sdk/protocol'
import type {RendererFrame} from '../frame.js'
import type {Side} from '../modes.js'
import type {PaneState} from '../pane.js'
import type {RendererPayloads} from './payloads.js'
import type {Anchors} from './selection.js'
import type {PaneKey, StageBinding} from './types.js'

export type StageBindingInput = {
  payloads: RendererPayloads
  stableValues: {[id: string]: ControlValue}
  action: StageBinding['action']
  filter: FilterPayload
  anchors: Anchors
  frames: {current: Record<Side, RendererFrame | null>}
  setPanes: (update: (previous: Record<PaneKey, PaneState>) => Record<PaneKey, PaneState>) => void
  setAnchors: (update: (previous: Anchors) => Anchors) => void
  selectFrom: (pane: PaneKey, id: string | null, path?: string) => void
  activateAnnotation: (rowId: string) => void
  selectedPath: Record<PaneKey, string | undefined>
  annotationMarks: AnnotationMark[]
}

/** What `ProjectionStage` binds its renderer frames to: the payloads they are sent and the handlers for their messages. */
export function useStageBinding(input: StageBindingInput): StageBinding {
  const {payloads, stableValues, action, filter, anchors, frames, setPanes, setAnchors} = input
  const {selectFrom, activateAnnotation, selectedPath, annotationMarks} = input
  const {init, environment, progressPayload, endpoints, diffProgress} = payloads
  return useMemo<StageBinding>(
    () => ({
      init,
      environment,
      progressPayload,
      endpoints,
      diffProgress,
      options: stableValues,
      action,
      filter,
      anchors,
      frames,
      onPaneState: {
        main: state => setPanes(previous => ({...previous, main: state})),
        before: state => setPanes(previous => ({...previous, before: state})),
        after: state => setPanes(previous => ({...previous, after: state})),
      },
      onAnchor: {
        before: (id, rect) => setAnchors(previous => ({...previous, before: {...previous.before, [id]: rect}})),
        after: (id, rect) => setAnchors(previous => ({...previous, after: {...previous.after, [id]: rect}})),
      },
      onFrame: {
        before: frame => {
          frames.current.before = frame
        },
        after: frame => {
          frames.current.after = frame
        },
      },
      // In swipe, scrolling one layer scrolls the other; the SDK suppresses the echo.
      onViewport: {
        before: position => frames.current.after?.scroll(position),
        after: position => frames.current.before?.scroll(position),
      },
      onSelect: {
        main: (id, path) => selectFrom('main', id, path),
        before: (id, path) => selectFrom('before', id, path),
        after: (id, path) => selectFrom('after', id, path),
      },
      onAnnotation: activateAnnotation,
      selectedPath,
      annotations: annotationMarks,
    }),
    [
      init,
      environment,
      progressPayload,
      endpoints,
      diffProgress,
      stableValues,
      action,
      filter,
      anchors,
      selectFrom,
      activateAnnotation,
      selectedPath,
      annotationMarks,
      frames,
      setPanes,
      setAnchors,
    ],
  )
}
