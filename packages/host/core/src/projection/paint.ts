import {useEffect} from 'react'
import type {InitPayload} from '@githubnext/projections-renderer-sdk/protocol'
import {twoPaneMode} from '../modes.js'
import type {ComparisonMode} from '../modes.js'
import type {PaneKey, ProjectionController, ProjectionOptions, RendererStatus} from './types.js'

/**
 * Whether the renderer frames show what the controller asks: `none` without a renderer; `loading` or `failed` while a
 * shown pane is; `painting` while a pane hasn't yet acknowledged painting the progress it was sent; `painted` once every
 * shown pane has (in two-pane modes the before pane its start and the after pane its end, in Animated the current
 * progress).
 */
export type PaintState = 'none' | 'loading' | 'failed' | 'painting' | 'painted'

/**
 * The frames' paint state for a controller's renderer, mode, progress and panes (see `PaintState`). With the stage's
 * `init`, an acknowledgement of an earlier one (the frames haven't caught up with a new mode or subject yet) doesn't
 * count.
 */
export function paintState(
  projection: Pick<ProjectionController, 'renderer' | 'comparing' | 'mode' | 'progress' | 'panes'> & {stage?: {init: InitPayload}},
): PaintState {
  const {renderer, comparing, mode, progress, panes} = projection
  const init = projection.stage?.init
  if (!renderer) return 'none'
  const keys: PaneKey[] = twoPaneMode(mode) ? ['before', 'after'] : ['main']
  const shown = keys.map(key => panes[key])
  if (shown.some(pane => pane.status === 'failed')) return 'failed'
  if (shown.some(pane => pane.status === 'loading')) return 'loading'
  const expected = (key: PaneKey) => (key === 'before' ? 0 : key === 'after' ? 1 : comparing && mode === 'animated' ? progress : undefined)
  const painted = keys.every((key, index) => {
    const pane = shown[index]!
    const rendered = init && pane.renderedInit && pane.renderedInit !== init ? undefined : pane.rendered
    const target = expected(key)
    return rendered !== undefined && (target === undefined || Math.abs(rendered - target) < 1e-9)
  })
  return painted ? 'painted' : 'painting'
}

/** What `onPainted` reports: the mode and progress the frames settled on. */
export interface Painted {
  mode: ComparisonMode
  progress: number
}

/**
 * Tells the embedder when the renderer status changes (`onRendererStatusChange`, with the first status too) and when
 * the frames settle on what is shown while paused (`onPainted`, once each time they get there), so a host waits on the
 * core instead of observing the view's DOM.
 */
export function useStatusEvents({
  latest,
  status,
  paint,
  playing,
  mode,
  progress,
}: {
  latest: {current: Pick<ProjectionOptions, 'onRendererStatusChange' | 'onPainted'>}
  status: RendererStatus
  paint: PaintState
  playing: boolean
  mode: ComparisonMode
  progress: number
}) {
  useEffect(() => {
    latest.current.onRendererStatusChange?.(status)
  }, [latest, status])
  const settled = paint === 'painted' && !playing ? `${mode}|${progress}` : undefined
  useEffect(() => {
    if (settled !== undefined) latest.current.onPainted?.({mode, progress})
    // Only a new settled state reports; mode and progress are part of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, settled])
}
