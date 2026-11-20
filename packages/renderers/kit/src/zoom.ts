import {defineControls} from '@githubnext/projections-renderer-sdk/protocol'
import {openingFloorPx} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * Zoom actions the host draws for a scalable stage (see `useStageZoom`); pass
 * them as `mountRenderer(…, {controls: zoomControls})`. Pinch and Ctrl/⌘-wheel
 * zoom stay in the frame, and the stage scrolls to pan.
 */
export const zoomControls = defineControls([
  {id: 'zoom-out', label: 'Zoom out', type: 'action', icon: 'zoom-out', group: 'zoom'},
  {id: 'zoom-fit', label: 'Fit to view', type: 'action', icon: 'fit', group: 'zoom'},
  {id: 'zoom-in', label: 'Zoom in', type: 'action', icon: 'zoom-in', group: 'zoom'},
])

/**
 * Zoom as a multiple of the fitted scale: 1 fits everything (the minimum, and
 * the opening view unless that draws text below `openingFloorPx`), each Zoom in or out multiplies or divides by `step`, and
 * the most is `max` times the fit or `readable` (CSS px per content unit),
 * whichever is larger, so a fit too small to read can always be zoomed to a
 * legible size.
 */
export const zoomLimits = {max: 4, step: 1.5, readable: 2}

/** The largest zoom multiple for a stage fitted at `fit`. */
export function maxZoom(fit: number): number {
  return fit > 0 ? Math.max(zoomLimits.max, zoomLimits.readable / fit) : zoomLimits.max
}

/** `value` within 1 (fitted) and `maxZoom(fit)`, rounded to a millionth so stepping back lands exactly. */
export function clampZoom(value: number, fit: number): number {
  return Math.round(Math.min(maxZoom(fit), Math.max(1, value)) * 1e6) / 1e6
}

/**
 * Where content that overflows its opening view starts: fractions of its scroll range (`{x: 0, y: 0}` is the top
 * left, `{x: 0.5, y: 0}` the top centre of a centred layout), or a function of the drawn scale (and the view's size,
 * for a start that centres something) that returns the scroll offsets, for content whose reading start isn't a corner
 * of its bounds (see `contentStart`). Offsets are clamped to the scroll range. A start depends only on the content,
 * the scale and the view, never on highlighting, so the same content always opens at the same place; while the view
 * opens, it is placed again whenever the view settles to another size. Content fitted to the view never overflows; a
 * start places content opened at the text floor (see `openingFloorPx`), opened on a focus, or a stage that can't be
 * fitted yet, such as one laid out before its pane has a height.
 */
export type ScrollStart = {x: number; y: number} | ((view: {scale: number; width: number; height: number}) => {left: number; top: number})

export {openingFloorPx}
export {contentStart} from './content-start.js'
export type {ContentBox} from './content-start.js'

/** How far (as a share) a fit may fall below the floor and still open fitted: zooming a hair would only scroll a pixel. */
const floorSlack = 0.004

/**
 * The zoom multiple a stage fitted at `fit` opens at, given the scale `floor` at which its smallest text reaches
 * `openingFloorPx` (see `useOpeningFloor`; 0 when unknown): 1 (fitted) when the fit draws text at least that large,
 * else the multiple that brings it there.
 */
export function openingZoom(fit: number, floor: number): number {
  return floor > 0 && fit > 0 && floor / fit > 1 + floorSlack ? clampZoom(floor / fit, fit) : 1
}

/** The zoom `useStageZoom` applies: draw the content at `scale`. */
export interface StageZoom {
  /** The zoom multiple of the fitted scale (1 is fitted); a scroll container carries it as `data-zoom`. */
  zoom: number
  /** The drawn scale: the fitted scale times the zoom; 0 until the stage has been measured. */
  scale: number
  /** Keeps the view where the caller just scrolled it, as though the person had: later changes of scale keep its middle. */
  keep: () => void
  /** Whether the view is still on its opening: the person hasn't zoomed or panned since, nor `hold` set a zoom. */
  opening: boolean
}

/** Where `useStageZoom` opens the view; by default fitted, or at the text floor when fitting draws text too small. */
export interface StageZoomOptions {
  /**
   * The scale at which the smallest text reaches `openingFloorPx` (see `useOpeningFloor`): content whose fit is
   * smaller opens at it instead and scrolls. Measure it over everything the stage frames (both endpoints of a
   * transition), so it never changes while scrubbing.
   */
  floor?: number
  /** Where content that overflows the opening view starts (default the top left; see `ScrollStart`). */
  start?: ScrollStart
  /**
   * An opening view chosen by the caller instead, for example on a focus (see `RendererFocus`): its zoom multiple of
   * the fit (clamped to the zoom range) and where it starts. Like the default, it holds until the person zooms or pans.
   * `centred`: the start centres a focus in the view, so it isn't moved clear of a stage cover as a reading start is.
   */
  opening?: {zoom: number; start: ScrollStart; centred?: boolean}
  /**
   * A drawn scale (CSS px per content unit) to keep: whenever `key` changes, the zoom becomes the multiple of the fit
   * that draws at `scale` (within the zoom range), as though the person had zoomed there, so a view that changes its
   * content's size, and with it the fit, keeps its zoom.
   */
  hold?: {key: unknown; scale: number}
}

/**
 * The dot grid behind zoomable content (the kit's `pk-dot-grid` class on the scroll container): a dot every `units`
 * content units, so it is drawn `units * scale` CSS px apart and moves with the content as it pans and zooms; it fades
 * out between `fade.from` and `fade.to` CSS px apart, before it is dense enough to be noise.
 */
export const dotGridSpacing = {units: 16, fade: {from: 10, to: 5}}

/**
 * Where and how strongly to draw the dot grid at one zoom (`dotGrid`'s result), as CSS for the scroll container's
 * `background-size`, `background-position` and grid opacity.
 */
export interface DotGrid {
  /** CSS px between dots. */
  spacing: number
  /** The grid's horizontal offset in the scroll container's content, CSS px, within one spacing: a dot is at each multiple from it. */
  x: number
  /** Its vertical offset, likewise. */
  y: number
  /** 0 (hidden) to 1. */
  opacity: number
}

/**
 * The dot grid for content drawn at `scale` whose content-unit origin is `origin` CSS px into its scroll container's
 * scrollable area, so the dots stay put on the content: they pan with it (the grid scrolls with the content) and keep
 * their place on it as it zooms.
 */
export function dotGrid(scale: number, origin: {x: number; y: number}, spacing = dotGridSpacing): DotGrid {
  const step = spacing.units * scale
  const {from, to} = spacing.fade
  const opacity = step >= from ? 1 : step <= to ? 0 : (step - to) / (from - to)
  const phase = (offset: number) => (step > 0 ? ((offset % step) + step) % step : 0)
  return {spacing: step, x: phase(origin.x), y: phase(origin.y), opacity: Math.round(opacity * 1000) / 1000}
}
