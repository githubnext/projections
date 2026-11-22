import {useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject} from 'react'
import type {Row} from './model.js'
import type {ProjectionController} from './projection.js'
import {encodeTarget} from './targets/encoding.js'
import {useCardFocus} from './detail-card/focus.js'
import {intersect, placeDetailCard, samePlacement, type DetailCardPlacement, type PlacementRect} from './detail-card/placement.js'

/** The options of `useDetailCard`: where the card is placed and when it opens. */
export interface DetailCardOptions {
  /**
   * The card's containing block: a positioned element around the stage (and the table and text views), whose visible
   * box the card stays within. Its layout never changes when the card opens.
   */
  container: RefObject<HTMLElement | null>
  /**
   * The whole view around the container. A press in it outside the container (its toolbar, notices and popovers)
   * keeps the card open: those controls act on what the card is about. Without it, any press outside the card closes it.
   */
  view?: RefObject<HTMLElement | null> | undefined
  /** Whether to show a card for the selection (default true). */
  enabled?: boolean
  /** Containers narrower than this show the card as a bottom sheet (default 640). */
  sheetBelow?: number
}

/** A detail card's state for a UI to draw: `useDetailCard`. */
export interface DetailCard {
  /** The row the card is about while it is open, else `null`. */
  row: Row | null
  placement: DetailCardPlacement | null
  /** The card's position in its container (`position: absolute`), hidden until placed. */
  style: CSSProperties
  /** Attach to the card's element. */
  ref: (element: HTMLElement | null) => void
  /** Closes the card (the selection stays) and returns focus to where it came from: an element, or the renderer frame. */
  close: () => void
  /** Selects a row from inside the card (a connection), moving the card and keeping focus in it. */
  select: (rowId: string) => void
}

/**
 * The headless detail card for the selection: whether it is open, where it goes, and how it is dismissed. The card
 * overlays its container beside the selected item (`ProjectionController.anchorFor`, else the selected row's button
 * in a table or text view, `button[data-row-id]`), follows it as it moves, flips and shifts to stay in view, and on
 * containers narrower than `sheetBelow` is a bottom sheet. Opening never moves focus, except after a selection made
 * with the keyboard in the container (or from the card), when the card's title (`[data-detail-card-title]`) takes
 * it. Escape in the container, the close action or a pointer press outside the card (in the container, or outside
 * `view`) closes it; the selection stays, and any new selection opens it again. Closing returns focus to where it was before the card (or the renderer frame).
 */
export function useDetailCard(
  projection: ProjectionController,
  {container: containerRef, view, enabled = true, sheetBelow = 640}: DetailCardOptions,
): DetailCard {
  const selected = enabled ? (projection.selectedRow ?? null) : null
  const target = projection.selection?.target
  const key = selected ? `${selected.id}\u0000${target ? encodeTarget(target) : ''}` : null
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [seen, setSeen] = useState(key)
  if (seen !== key) {
    setSeen(key)
    setDismissed(null)
  }
  const open = key !== null && key !== dismissed
  const row = open ? selected : null
  const [card, setCard] = useState<HTMLElement | null>(null)
  const [placed, setPlaced] = useState<{placement: DetailCardPlacement; left: number; top: number} | null>(null)
  const placement = placed?.placement ?? null
  // The committed render's, for measuring; reading it there doesn't measure again when it changes.
  const anchorFor = useRef(projection.anchorFor)
  useLayoutEffect(() => {
    anchorFor.current = projection.anchorFor
  })

  const rowId = row?.id
  const measure = useCallback(() => {
    const box = containerRef.current
    if (!box || !card || rowId === undefined) return
    const rect = box.getBoundingClientRect()
    const viewport = {x: 0, y: 0, width: document.documentElement.clientWidth || innerWidth, height: innerHeight}
    const bounds = intersect({x: rect.x, y: rect.y, width: rect.width, height: rect.height}, viewport) ?? {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: 0,
    }
    let anchor: PlacementRect | null = anchorFor.current(rowId)
    if (!anchor) {
      const button = [...box.querySelectorAll<HTMLElement>(`button[data-row-id="${CSS.escape(rowId)}"]`)].find(
        element => !card.contains(element) && element.getClientRects().length > 0,
      )
      if (button) anchor = button.getBoundingClientRect()
    }
    anchor &&= intersect(anchor, bounds)
    const frame = card.offsetHeight - card.clientHeight
    const next = placeDetailCard({anchor, height: card.scrollHeight + frame, bounds, sheetBelow})
    // The card is positioned in its container's padding box.
    const left = next.x - rect.x - box.clientLeft
    const top = next.y - rect.y - box.clientTop
    setPlaced(previous =>
      previous && samePlacement(previous.placement, next) && Math.abs(previous.left - left) < 0.5 && Math.abs(previous.top - top) < 0.5
        ? previous
        : {placement: next, left, top},
    )
  }, [containerRef, card, rowId, sheetBelow])

  // The anchor moves when the renderer reports it, and the views' rows as they lay out (observed below).
  const anchors = projection.anchorFor
  if (!row && placed) setPlaced(null)
  useLayoutEffect(() => {
    if (row) measure()
  }, [row, measure, anchors])
  useEffect(() => {
    if (!row) return undefined
    let frame = 0
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0
          measure()
        })
      }
    }
    addEventListener('scroll', schedule, {capture: true, passive: true})
    addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    // A view switch, filter or playback step changes the rows a table or text view draws.
    const mutations = new MutationObserver(schedule)
    if (containerRef.current) {
      observer.observe(containerRef.current)
      mutations.observe(containerRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'class', 'style'],
      })
    }
    if (card) observer.observe(card)
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('scroll', schedule, {capture: true})
      removeEventListener('resize', schedule)
      observer.disconnect()
      mutations.disconnect()
    }
  }, [row, measure, containerRef, card])

  const {close, select} = useCardFocus({projection, container: containerRef, view, card, row, key, setDismissed, shown: placement !== null})

  const style: CSSProperties = placed
    ? {position: 'absolute', left: placed.left, top: placed.top, width: placement!.width, maxHeight: placement!.maxHeight, zIndex: 20}
    : {position: 'absolute', left: 0, top: 0, visibility: 'hidden', zIndex: 20}

  return {row, placement, style, ref: setCard, close, select}
}
