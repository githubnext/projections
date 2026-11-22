import {
  defaultComparisonMode,
  defaultComparisonModes,
  orderComparisonModes,
  type AnchorRect,
  type ComparisonMode,
} from '@githubnext/projections-renderer-sdk/protocol'

/**
 * How a comparison is presented in the renderer view: `animated` (one frame
 * scrubbed from before to after), `side-by-side` and `swipe` (one frame per
 * revision), or `diff` (one frame drawing its own static comparison). Each
 * renderer declares the modes it supports.
 */
export type {ComparisonMode}
/** One revision of a comparison: `before` is the base, `after` the head. */
export type Side = 'before' | 'after'
/** Every comparison mode with its label, in display order. Offer only a renderer's `availableModes`. */
export const comparisonModes: readonly {value: ComparisonMode; label: string}[] = [
  {value: 'diff', label: 'Diff'},
  {value: 'side-by-side', label: 'Side by side'},
  {value: 'animated', label: 'Animated'},
  {value: 'swipe', label: 'Swipe'},
]
export {defaultComparisonMode, defaultComparisonModes, orderComparisonModes}

/** Whether a mode presents both revisions in two frames (side by side or swipe). */
export const twoPaneMode = (mode: ComparisonMode) => mode === 'side-by-side' || mode === 'swipe'

/** A chosen mode if the renderer supports it, else its default: diff when supported, else side by side (`defaultComparisonMode`). */
export function clampMode(chosen: ComparisonMode | undefined, available: readonly ComparisonMode[]): ComparisonMode {
  const modes = available.length ? available : defaultComparisonModes
  return chosen !== undefined && modes.includes(chosen) ? chosen : defaultComparisonMode(modes)
}

/**
 * A connector between the selected item in two panes, in px in the stage's coordinates: from the before pane's
 * rectangle (`x1`, `y1`) to the after pane's (`x2`, `y2`). A `vertical` one joins stacked panes by their left edges
 * through a `gutter` that far from the panes' left edge.
 */
export interface Connector {
  x1: number
  y1: number
  x2: number
  y2: number
  vertical: boolean
  gutter?: number
}

/** Distance of the stacked connector's gutter from the panes' left edge. */
export const connectorGutter = 8

/**
 * Places a frame-viewport rectangle in `origin`'s coordinates through the
 * frame's box, or returns undefined when it falls outside the frame.
 */
function place(frame: HTMLIFrameElement, rect: AnchorRect, origin: DOMRect) {
  const box = frame.getBoundingClientRect()
  const left = box.left + frame.clientLeft + rect.x
  const top = box.top + frame.clientTop + rect.y
  const right = left + rect.width
  const bottom = top + rect.height
  const inside = {
    left: box.left + frame.clientLeft,
    top: box.top + frame.clientTop,
    right: box.left + frame.clientLeft + frame.clientWidth,
    bottom: box.top + frame.clientTop + frame.clientHeight,
  }
  if (right <= inside.left || left >= inside.right || bottom <= inside.top || top >= inside.bottom) return undefined
  return {left: left - origin.left, top: top - origin.top, right: right - origin.left, bottom: bottom - origin.top, frame: box}
}

/**
 * The connector between the selected entity's rectangles in the before and
 * after frames.
 */
export function connectorBetween(
  before: HTMLIFrameElement,
  after: HTMLIFrameElement,
  from: AnchorRect,
  to: AnchorRect,
  origin: DOMRect,
): Connector | undefined {
  const a = place(before, from, origin)
  const b = place(after, to, origin)
  if (!a || !b) return undefined
  const vertical = b.frame.top >= a.frame.bottom - 1
  return vertical
    ? {x1: a.left, y1: (a.top + a.bottom) / 2, x2: b.left, y2: (b.top + b.bottom) / 2, vertical, gutter: connectorGutter}
    : {x1: a.right, y1: (a.top + a.bottom) / 2, x2: b.left, y2: (b.top + b.bottom) / 2, vertical}
}

/**
 * The SVG path data that draws a connector: a horizontal S-curve between side-by-side panes, or, for stacked panes,
 * out to the gutter, down it and back in, with corners rounded up to 8px.
 */
export function connectorPath({x1, y1, x2, y2, vertical, gutter = connectorGutter}: Connector): string {
  if (vertical) {
    const radius = Math.max(0, Math.min(8, (y2 - y1) / 2, x1 - gutter, x2 - gutter))
    return `M ${x1} ${y1} H ${gutter + radius} Q ${gutter} ${y1} ${gutter} ${y1 + radius} V ${y2 - radius} Q ${gutter} ${y2} ${gutter + radius} ${y2} H ${x2}`
  }
  const bend = Math.max(16, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}
