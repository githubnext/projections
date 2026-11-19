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
  const match = /^\s*(\d+(?:\.\d+)?)(px|vh)\s*$/.exec(token ?? '')
  if (!match) return undefined
  const value = Number(match[1])
  if (match[2] === 'px') return Math.max(contentMinimumCap, Math.round(value))
  return viewport && viewport.height > 0 ? Math.max(contentMinimumCap, Math.round((viewport.height * value) / 100)) : undefined
}
