/** A rectangle in viewport coordinates (CSS px, like `getBoundingClientRect`). */
export interface PlacementRect {
  x: number
  y: number
  width: number
  height: number
}

/** Where a detail card sits beside its anchor: `over` when there is no anchor (the bounds' top end corner). */
export type DetailCardSide = 'right' | 'left' | 'below' | 'above' | 'over'

/** A detail card's placement, in viewport coordinates. */
export interface DetailCardPlacement {
  /** A bottom sheet across the bounds, for narrow stages. */
  sheet: boolean
  side: DetailCardSide
  x: number
  y: number
  width: number
  maxHeight: number
}

/** What `placeDetailCard` places a card from: the anchor, the card's size and its bounds, in px in one space. */
export interface DetailCardPlacementOptions {
  /** Where the item is drawn, or `null` when it isn't visible. */
  anchor: PlacementRect | null
  /** The card's natural height (its content's), in px. */
  height: number
  /** The area the card must stay within: the stage's visible box. */
  bounds: PlacementRect
  /** The card's preferred width (default 320). */
  width?: number
  /** Space between the anchor and the card (default 8). */
  gap?: number
  /** Space between the card and the bounds' edges (default 8). */
  margin?: number
  /** Bounds narrower than this get a bottom sheet (default 640). */
  sheetBelow?: number
}

/**
 * Places a detail card beside its anchor without leaving the bounds: to the right, else the left, below or above,
 * aligned with the anchor and shifted to stay inside; when no side has room, on the roomier side of right and left,
 * shifted inside (over the anchor's edge). Without an anchor it takes the bounds' top end corner. Bounds narrower
 * than `sheetBelow` get a bottom sheet across their width instead.
 */
export function placeDetailCard({
  anchor,
  height,
  bounds,
  width: preferred = 320,
  gap = 8,
  margin = 8,
  sheetBelow = 640,
}: DetailCardPlacementOptions): DetailCardPlacement {
  const left = bounds.x + margin
  const top = bounds.y + margin
  const right = bounds.x + bounds.width - margin
  const bottom = bounds.y + bounds.height - margin
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)))
  if (bounds.width < sheetBelow) {
    const maxHeight = Math.max(0, Math.round(bounds.height * 0.6))
    const shown = Math.min(height, maxHeight)
    return {sheet: true, side: 'below', x: bounds.x, y: bounds.y + bounds.height - shown, width: bounds.width, maxHeight}
  }
  const width = Math.max(0, Math.min(preferred, right - left))
  const maxHeight = Math.max(0, bottom - top)
  const shown = Math.min(height, maxHeight)
  const place = (side: DetailCardSide, x: number, y: number): DetailCardPlacement => ({sheet: false, side, x, y, width, maxHeight})
  if (!anchor) return place('over', right - width, top)
  const alignedY = clamp(anchor.y, top, bottom - shown)
  const alignedX = clamp(anchor.x, left, right - width)
  const toRight = anchor.x + anchor.width + gap
  if (toRight + width <= right) return place('right', toRight, alignedY)
  const toLeft = anchor.x - gap - width
  if (toLeft >= left) return place('left', toLeft, alignedY)
  const below = anchor.y + anchor.height + gap
  if (below + shown <= bottom) return place('below', alignedX, below)
  const above = anchor.y - gap - shown
  if (above >= top) return place('above', alignedX, above)
  const roomRight = right - (anchor.x + anchor.width)
  const roomLeft = anchor.x - left
  return roomRight >= roomLeft
    ? place('right', clamp(toRight, left, right - width), alignedY)
    : place('left', clamp(toLeft, left, right - width), alignedY)
}

/** The overlap of two rectangles, or `null` when they don't overlap by a pixel. */
export const intersect = (a: PlacementRect, b: PlacementRect): PlacementRect | null => {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const width = Math.min(a.x + a.width, b.x + b.width) - x
  const height = Math.min(a.y + a.height, b.y + b.height) - y
  return width >= 1 && height >= 1 ? {x, y, width, height} : null
}
/** Whether two placements are the same to half a pixel. */
export const samePlacement = (a: DetailCardPlacement | null, b: DetailCardPlacement | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.sheet === b.sheet &&
    a.side === b.side &&
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.maxHeight - b.maxHeight) < 0.5)
