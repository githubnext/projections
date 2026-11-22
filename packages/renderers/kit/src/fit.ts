/** How `useFitScale` fits content to its stage. */
export interface FitOptions {
  /** Space kept around the content inside the stage, CSS px (default 16), or apart across (`x`) and down (`y`). */
  padding?: number | FitPadding
  /** Largest scale (default 1: small content is centred at its own size, never enlarged). */
  maxScale?: number
  /** Smallest stage height to ask a content-sized host for, CSS px (default 200), unless the content is scaled down to its width. */
  minHeight?: number
  /**
   * The scale at which the content's smallest text reaches the kit's `openingFloorPx` (see `useOpeningFloor`; pass
   * the same to `useStageZoom`). When fitting the width draws text smaller, a content-sized host is asked for the
   * height the content takes at that floor, where it opens, so the opening view pans only sideways.
   */
  floor?: number
  /**
   * The shape (width / height) to report for arranging held panes, when the view opens on part of the content (see
   * `StageZoomOptions.opening`) rather than all of it; default the content's own.
   */
  aspect?: number
  /**
   * The scale the content is drawn at now (see `useStageZoom`). Zoomed in past where it opens, a content-sized host is
   * asked for the height it takes at that scale, up to its `stage-max-height`, so the stage grows into the page before
   * it pans; the fit itself never depends on it.
   */
  drawnScale?: number
}

/** Space around fitted content, CSS px: across (each side, left and right) and down (top and bottom). */
export interface FitPadding {
  /** Space at the content's left and at its right, CSS px. */
  x: number
  /** Space above the content and below it, CSS px. */
  y: number
  /** Space above the content, CSS px, when it differs from `y` (a host's `stage-inset-top`); `y` stays below it. */
  top?: number
}

/** `padding` across and down. */
export function fitPadding(padding: number | FitPadding = 16): FitPadding {
  return typeof padding === 'number' ? {x: padding, y: padding} : padding
}

/** The space `padding` keeps above the content and the space it keeps above and below together, CSS px. */
export function fitPaddingDown(padding: number | FitPadding = 16): {top: number; total: number} {
  const {y, top = y} = fitPadding(padding)
  return {top, total: top + y}
}

/** The fit `useFitScale` measured: the content's scale and the stage's inner size. */
export interface Fit {
  /** Scale from content units to CSS px at which all of the content fits the stage; 0 until the stage has been measured. */
  scale: number
  /** The stage's inner width, CSS px; 0 until measured. */
  width: number
  /** The stage's inner height, CSS px; 0 until measured. */
  height: number
}

/**
 * The scale at which content of `size` fits a stage of `stage` (CSS px) with `padding` around it, in both
 * dimensions and never above `maxScale`, and the scale that fits only its width, which a content-sized host's
 * preferred height is measured at.
 */
export function fitScale(
  size: {width: number; height: number},
  stage: {width: number; height: number},
  {padding = 16, maxScale = 1}: Pick<FitOptions, 'padding' | 'maxScale'> = {},
): {scale: number; widthFirst: number} {
  const {x} = fitPadding(padding)
  const across = Math.max(0, stage.width - 2 * x) / size.width
  const down = Math.max(0, stage.height - fitPaddingDown(padding).total) / size.height
  return {scale: Math.min(maxScale, across, down), widthFirst: Math.min(maxScale, across)}
}

/** The least a content-sized stage that pans and zooms is capped at, CSS px, however short the window. */
export const contentMinimumCap = 360

/**
 * The most a content-sized frame whose content pans and zooms asks for, CSS px, from the host's optional
 * `stage-max-height` theme token: a length in `px`, or in `vh` of the host window's height (`viewport`, as the host
 * reports it), at least `contentMinimumCap`. Undefined when the host sends no such token (the frame takes the
 * content's height, uncapped) or a `vh` value before the host has reported its viewport. A host that lays the frame in
 * its scrolling page sends it, so a canvas no taller than the window can be seen whole, and panned, without scrolling
 * the page; content taller than that at the opening scale is fitted to the capped stage, or opens at the floor and pans.
 */
export function contentHeightCap(token: string | undefined, viewport: {height: number} | undefined): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)(px|vh)\s*$/u.exec(token ?? '')
  if (!match) return undefined
  const value = Number(match[1])
  if (match[2] === 'px') return Math.max(contentMinimumCap, Math.round(value))
  return viewport && viewport.height > 0 ? Math.max(contentMinimumCap, Math.round((viewport.height * value) / 100)) : undefined
}

/** A rectangle of the frame the host overlays (its `stage-cover` theme token), CSS px from the frame's top left. */
export interface CoverRect {
  /** Its left edge, CSS px from the frame's left. */
  x: number
  /** Its top edge, CSS px from the frame's top. */
  y: number
  /** Its width, CSS px. */
  width: number
  /** Its height, CSS px. */
  height: number
}

/**
 * The host's `stage-cover` theme token as rectangles: `x y width height` in CSS px, separated by commas. Undefined when
 * the host sends none (the renderer keeps to `stage-inset-top`, if any); empty when it sends one that covers nothing.
 */
export function parseStageCover(token: string | undefined): CoverRect[] | undefined {
  if (token === undefined) return undefined
  const rects: CoverRect[] = []
  for (const part of token.split(',')) {
    const numbers = part.trim().split(/\s+/u).map(Number)
    if (numbers.length !== 4 || numbers.some(value => !Number.isFinite(value))) continue
    const [x, y, width, height] = numbers as [number, number, number, number]
    if (width > 0 && height > 0) rects.push({x, y, width, height})
  }
  return rects
}

/** The space kept between a fitted drawing and a cover above it, CSS px. */
export const coverGap = 8

/**
 * Where a fitted drawing lies before any cover moves it, and the cover's rectangles at the stage's top and at its foot:
 * those above and below its middle, or with the host's `insets`, those within its top inset and all the others.
 */
function uncoveredFit({cover, view, origin = {x: 0, y: 0}, size, padding = 16, maxScale = 1, insets}: CoveredFitInput): {
  left: number
  width: number
  top: number
  bottom: number
  above: CoverRect[]
  below: CoverRect[]
} {
  const {x, y, top = y} = fitPadding(padding)
  const {scale} = fitScale(size, view, {padding, maxScale})
  const width = size.width * scale,
    height = size.height * scale
  const left = origin.x + Math.max(x, (view.width - width) / 2)
  const contentTop = origin.y + Math.max(0, (view.height - (height + top + y)) / 2) + top
  const middle = origin.y + view.height / 2
  const across = cover.filter(rect => rect.x < left + width && rect.x + rect.width > left)
  const atTop = insets ? (rect: CoverRect) => rect.y + rect.height <= insets.top : (rect: CoverRect) => rect.y + rect.height / 2 <= middle
  return {
    left,
    width,
    top: contentTop,
    bottom: contentTop + height,
    above: across.filter(atTop),
    below: across.filter(rect => !atTop(rect)),
  }
}

/** What `coveredTop` and `coveredBottom` fit: the cover, the stage `view` at `origin` in the frame, and the drawing. */
interface CoveredFitInput {
  cover: readonly CoverRect[]
  view: {width: number; height: number}
  origin?: {x: number; y: number}
  size: {width: number; height: number}
  padding?: number | FitPadding
  maxScale?: number
  /**
   * In a frame the host sizes to its content, the host's `stage-inset-top` and `stage-inset-bottom` (0 where it sends
   * none), CSS px in from the frame's top and bottom edges, and how much of the frame lies `below` the stage, CSS px
   * (such as a footer, which keeps clear of the inset itself); see `coveredBottom`.
   */
  insets?: {top: number; bottom: number; below?: number}
}

const fitsNothing = ({cover, view, size}: CoveredFitInput) =>
  !cover.length || view.width <= 0 || view.height <= 0 || size.width <= 0 || size.height <= 0

/**
 * The space a fitted drawing keeps above it, CSS px, so it never opens under what the host overlays at the stage's
 * top (`cover`, the rectangles above its middle, or with `insets` within the top one, see `coveredBottom`): the
 * drawing is fitted with `padding` and centred in a stage of `view` whose top left is `origin` in the frame, as
 * `useFitScale` and a `margin: auto` drawing place it. Where that leaves it clear of every rectangle (a flat graph
 * centred well below a chip), the padding's own top; else the top that clears the lowest rectangle it reaches, by
 * `coverGap`. Decided from the drawing's fit without the cover, never from the result, so it can't oscillate. The
 * drawing still pans under the cover once zoomed.
 */
export function coveredTop(input: CoveredFitInput): number {
  const {y, top = y} = fitPadding(input.padding)
  if (fitsNothing(input)) return top
  const origin = input.origin ?? {x: 0, y: 0}
  const fit = uncoveredFit(input)
  const reached = fit.above.filter(rect => rect.y < fit.bottom && rect.y + rect.height > origin.y)
  if (!reached.length) return top
  const bottom = Math.max(...reached.map(rect => rect.y + rect.height)) + coverGap
  return bottom <= fit.top ? top : Math.max(top, Math.ceil(bottom - origin.y))
}

/**
 * The space a fitted drawing keeps below it, CSS px, as `coveredTop` keeps above: clear of what the host overlays at
 * the stage's foot (the rectangles below its middle, such as a floating legend and summary), only where the fitted
 * drawing would reach them; else the padding's own bottom (`y`). In a frame the host sizes to its content (`insets`),
 * the rectangles are measured from the frame's top, while what floats at its foot moves with its bottom as the frame
 * grows: measured at one height and placed in the frame at another, they would put the foot anywhere, even above the
 * middle, and the height asked for from them would feed back. There the host's insets, which it measures with the
 * rectangles at one height, place them instead: a rectangle whose bottom lies within `stage-inset-top` is at the top,
 * every other one at the foot. The drawing spans the frame's height, so it reaches every one at the foot that lies
 * across it, and its bottom is then `stage-inset-bottom`, measured up from the frame's bottom edge, less what lies
 * below the stage (`insets.below`).
 */
export function coveredBottom(input: CoveredFitInput): number {
  const {y} = fitPadding(input.padding)
  if (fitsNothing(input)) return y
  const origin = input.origin ?? {x: 0, y: 0}
  const fit = uncoveredFit(input)
  if (input.insets) {
    const {bottom, below = 0} = input.insets
    return fit.below.length ? Math.max(y, Math.ceil(bottom - below)) : y
  }
  const reached = fit.below.filter(rect => rect.y + rect.height > fit.top && rect.y < origin.y + input.view.height)
  if (!reached.length) return y
  const edge = Math.min(...reached.map(rect => rect.y)) - coverGap
  return edge >= fit.bottom ? y : Math.max(y, Math.ceil(origin.y + input.view.height - edge))
}

/**
 * The top and bottom (`y`) a fitted drawing keeps from the host's covers at both ends (`coveredTop`, `coveredBottom`),
 * resolved together: moving one edge refits and recentres the drawing, which can then reach the other end's cover, so
 * each is raised until the fit clears both (only ever raised, so it settles in a few steps).
 */
export function coveredPadding(input: CoveredFitInput): {top: number; y: number} {
  const base = fitPadding(input.padding)
  let padding = {...base, top: base.top ?? base.y}
  for (let step = 0; step < 4; step++) {
    const next = {...padding, top: coveredTop({...input, padding}), y: coveredBottom({...input, padding})}
    if (next.top === padding.top && next.y === padding.y) break
    padding = next
  }
  return {top: padding.top, y: padding.y}
}

/**
 * The top and bottom (`y`) padding of a drawing drawn larger than its fit, CSS px, so it clears bands of `inset.top`
 * and `inset.bottom` at the ends of a stage `view` px tall: `height` is the drawing's own height at the drawn scale.
 * While it still fits the stage's height it sits centred (`margin: auto`) and keeps `own` where that leaves it clear,
 * else just enough more at the end it reaches to clear the band; once that padding no longer fits, the drawing scrolls
 * and each end is padded at least its band, so its first and last rows can scroll clear.
 */
export function scrolledPadding({
  own,
  inset,
  height,
  view,
}: {
  own: {top: number; y: number}
  inset: {top: number; bottom: number}
  height: number
  view: number
}): {top: number; y: number} {
  const scrolls = {top: Math.max(own.top, inset.top), y: Math.max(own.y, inset.bottom)}
  const space = view - height
  if (view <= 0 || space < own.top + own.y) return scrolls
  // Centred, the drawing's top sits (space + top - y) / 2 below the stage's, and its bottom as far above the stage's.
  let {top, y} = own
  if ((space + top - y) / 2 < inset.top) top = y + 2 * inset.top - space
  if ((space - top + y) / 2 < inset.bottom) y = top + 2 * inset.bottom - space
  if (top + y > space || (space + top - y) / 2 < inset.top - 0.5) return scrolls
  return {top: Math.ceil(top), y: Math.ceil(y)}
}
