// Where a staged graph transition's layout is at a moment: settled on one layout, or moving between two.
import type {GraphLayout} from '../layout.js'
import type {StepWindows} from '../stages.js'
import {moveEasing} from '../stages.js'
import {interpolate} from './morph.js'

/**
 * Below this an entity is invisible, so it is omitted from the frame. The
 * threshold also keeps presence free of floating-point boundary artefacts,
 * which would otherwise make a transition and its mirror disagree by one frame.
 */
export const VISIBLE = 1e-6

/** One move between two layouts, and the routes it redraws rather than morphs (see `crossingMorphs`). */
export interface LayoutMove {
  easing: StepWindows['easing']
  time: number
  radius: number
  before: GraphLayout
  after: GraphLayout
  redraw: ReadonlySet<string>
}

export interface Geometry {
  from: GraphLayout
  to: GraphLayout
  mix: number
  width: number
  height: number
  redraw?: ReadonlySet<string>
}

export function geometry(events: readonly LayoutMove[], initial: GraphLayout, progress: number): Geometry {
  let settled = initial
  for (const event of events) {
    const start = event.time - event.radius
    const end = event.time + event.radius
    if (progress < start) break
    if (progress <= end && end > start) {
      const fraction = (progress - start) / (end - start)
      const mix = moveEasing(event.easing, fraction)
      return {
        from: event.before,
        to: event.after,
        mix,
        redraw: event.redraw,
        width: interpolate(event.before.width, event.after.width, mix),
        height: interpolate(event.before.height, event.after.height, mix),
      }
    }
    settled = event.after
  }
  return {from: settled, to: settled, mix: 0, width: settled.width, height: settled.height}
}
