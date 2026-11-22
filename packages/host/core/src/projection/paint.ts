import type {InitPayload} from '@githubnext/projections-renderer-sdk/protocol'
import {twoPaneMode, type ComparisonMode} from '../modes.js'
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

/** What the status events are worked out from, after each change. */
export interface StatusView {
  status: RendererStatus
  paint: PaintState
  playing: boolean
  mode: ComparisonMode
  progress: number
}

/** The events a host is told: `onRendererStatusChange` and `onPainted` (see `ProjectionOptions`). */
export type StatusEvents = Pick<ProjectionOptions, 'onRendererStatusChange' | 'onPainted'>

/**
 * Tells the embedder when the renderer status changes (`onRendererStatusChange`, with the first status too) and when
 * the frames settle on what is shown while paused (`onPainted`, once each time they get there), so a host waits on the
 * core instead of observing the view's DOM. Without a framework: call the returned function with each new view.
 */
export function createStatusEvents(): (view: StatusView, events: StatusEvents) => void {
  let last: {status: RendererStatus; settled: string | undefined} | undefined
  return ({status, paint, playing, mode, progress}, events) => {
    const settled = paint === 'painted' && !playing ? `${mode}|${progress}` : undefined
    const before = last
    last = {status, settled}
    if (before?.status !== status) events.onRendererStatusChange?.(status)
    if (settled !== undefined && before?.settled !== settled) events.onPainted?.({mode, progress})
  }
}
