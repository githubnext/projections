import type {CSSProperties} from 'react'

export type Placement = 'below-start' | 'below-end' | 'below-center' | 'top-center' | 'beside'

/** Space kept between an overlay and the edges of the view, px. */
const margin = 8

/** Where an overlay goes, and whether a `beside` overlay had to cover the menu it opens from. */
export interface Placed {
  style: CSSProperties
  inPlace: boolean
}

/** The view's size, the overlay's box and its content's full height, and clamps that keep it inside the view. */
interface Frame {
  width: number
  height: number
  box: DOMRect
  natural: number
  room: number
  clampX: (x: number) => number
  clampY: (y: number) => number
}

function frameOf(overlay: HTMLElement): Frame {
  const view = overlay.ownerDocument.documentElement
  const width = view.clientWidth
  const height = view.clientHeight
  const box = overlay.getBoundingClientRect()
  // The content's full height, however much of it the current maximum shows.
  const natural = overlay.scrollHeight + (overlay.offsetHeight - overlay.clientHeight)
  const room = Math.max(0, height - 2 * margin)
  return {
    width,
    height,
    box,
    natural,
    room,
    clampX: x => Math.max(margin, Math.min(x, width - box.width - margin)),
    clampY: y => Math.max(margin, Math.min(y, height - margin - Math.min(natural, room))),
  }
}

/** Centered at the top of the anchor (or of the view, without one). */
function topCenter(anchor: Element | null, {width, height, box, clampX}: Frame): Placed {
  const frame = anchor?.getBoundingClientRect() ?? {left: 0, width, top: 0}
  const top = Math.max(margin, frame.top + margin)
  return {
    style: {left: clampX(frame.left + (frame.width - box.width) / 2), top, maxHeight: Math.max(0, height - margin - top)},
    inPlace: false,
  }
}

/** Beside the menu the anchor is in, on the side with room for it, or over the menu when neither side has room. */
function beside(anchor: Element, rect: DOMRect, {width, box, room, clampX, clampY}: Frame): Placed {
  const menu = anchor.closest('.phv-overlay')?.getBoundingClientRect() ?? rect
  const right = menu.right - 2
  const left = menu.left - box.width + 2
  const inPlace = right + box.width > width - margin && left < margin
  const x = inPlace ? menu.left : right + box.width <= width - margin ? right : left
  // The first item level with the item it opens from (the menu's padding and border above it).
  const y = inPlace ? menu.top : rect.top - 5
  return {style: {left: clampX(x), top: clampY(y), maxHeight: room}, inPlace}
}

/** Under the anchor, or over it when there is more room there. */
function belowOrAbove(rect: DOMRect, placement: Placement, {height, box, natural, clampX}: Frame): Placed {
  const x =
    placement === 'below-end' ? rect.right - box.width : placement === 'below-center' ? rect.left + (rect.width - box.width) / 2 : rect.left
  const gap = 2
  const below = Math.max(0, height - margin - rect.bottom - gap)
  const above = Math.max(0, rect.top - gap - margin)
  if (natural <= below || below >= above) return {style: {left: clampX(x), top: rect.bottom + gap, maxHeight: below}, inPlace: false}
  return {style: {left: clampX(x), top: rect.top - gap - Math.min(natural, above), maxHeight: above}, inPlace: false}
}

/**
 * The overlay's fixed position, kept inside the view (the webview or the page): under its anchor, or over it when
 * there is more room there, never taller than the room on that side, so its content scrolls inside it and every
 * item stays reachable. `beside` opens a submenu at the side of its menu with room for it, or over the menu when
 * neither side has room.
 */
export function position(anchor: Element | null, overlay: HTMLElement, placement: Placement): Placed {
  const frame = frameOf(overlay)
  if (!anchor || placement === 'top-center') return topCenter(anchor, frame)
  const rect = anchor.getBoundingClientRect()
  return placement === 'beside' ? beside(anchor, rect, frame) : belowOrAbove(rect, placement, frame)
}
