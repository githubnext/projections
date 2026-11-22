// Placing a new view so the card in the activated one's place is where that one was on screen.
import {useEffect, useLayoutEffect, useRef, type RefObject} from 'react'
import type {GraphFrame, GraphTransition} from '../../graph-transition.js'
import type {Point} from '../../edge-arrows.js'
import type {Bounds} from './framing.js'
import {corner, type ViewChange} from './moving-view.js'

/** Where a drawing's layout origin (its bounds' top left) is, in CSS px from the top left of its scroll container's view. */
function drawingOrigin(element: HTMLElement, svg: SVGSVGElement): Point {
  const frame = element.getBoundingClientRect(),
    drawn = svg.getBoundingClientRect()
  const style = getComputedStyle(svg)
  return {
    x:
      drawn.left -
      frame.left -
      element.clientLeft +
      Number.parseFloat(style.paddingLeft || '0') +
      Number.parseFloat(style.borderLeftWidth || '0'),
    y:
      drawn.top -
      frame.top -
      element.clientTop +
      Number.parseFloat(style.paddingTop || '0') +
      Number.parseFloat(style.borderTopWidth || '0'),
  }
}

/** The drawing's padding sides `useAnchoredScroll` may grow. */
const sides = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const

/**
 * Once a new view noted by `useViewChange` is drawn at the kept scale, scrolls so the card in the activated one's
 * place has its top left corner where the activated one's was on screen, and keeps the view there (`keep`). Where the
 * content doesn't reach far enough to scroll there (a boundary that opens at the top of the new layout), the drawing
 * gets that much more room on that side, until the next view. Call it after `useGraphZoom`, so it places the view
 * after the zoom does.
 */
export function useAnchoredScroll(
  scrollerRef: RefObject<HTMLDivElement | null>,
  change: ViewChange | undefined,
  transition: GraphTransition,
  target: GraphFrame,
  bounds: Bounds,
  scale: number,
  keep: () => void,
) {
  const laid = useRef(transition)
  const placed = useRef<ViewChange>(undefined)
  // A view change and where the drawing was on screen when its view was drawn, until it is placed.
  const noted = useRef<{change: ViewChange; origin: Point | undefined}>(undefined)
  // Where the drawing's origin is on screen as the person last saw it: recorded as each render leaves it, and as the
  // view scrolls or resizes, so a new view (which redraws it) is placed from where it was.
  const shownOrigin = useRef<Point>(undefined)
  useEffect(() => {
    const element = scrollerRef.current
    if (!element) return undefined
    const record = () => {
      const svg = element.querySelector<SVGSVGElement>('svg.graph')
      if (svg) shownOrigin.current = drawingOrigin(element, svg)
    }
    element.addEventListener('scroll', record, {passive: true})
    const observer = new ResizeObserver(record)
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', record)
      observer.disconnect()
    }
  }, [scrollerRef])
  useLayoutEffect(() => {
    const element = scrollerRef.current
    const svg = element?.querySelector<SVGSVGElement>('svg.graph')
    if (!element || !svg) return
    // Recorded as this render leaves the drawing.
    const record = () => {
      shownOrigin.current = drawingOrigin(element, svg)
    }
    const pending = change !== placed.current ? change : undefined
    if (pending && noted.current?.change !== pending) noted.current = {change: pending, origin: shownOrigin.current}
    const origin = noted.current?.origin
    const now = pending && scale && origin ? target.nodes.find(node => node.id === pending.to) : undefined
    if (!pending || !now || !origin) {
      // Room added for an earlier view goes with the next one.
      if (laid.current !== transition && !pending) for (const side of sides) svg.style[side] = ''
      laid.current = transition
      record()
      return
    }
    placed.current = pending
    const wanted = {x: origin.x + pending.at.x, y: origin.y + pending.at.y}
    laid.current = transition
    for (const side of sides) svg.style[side] = ''
    const at = corner(now)
    // Until it is there: room added on one side of a drawing narrower than its view, which is centred in it, moves the
    // drawing only half as far.
    for (let pass = 0; pass < 12; pass++) {
      const drawn = drawingOrigin(element, svg)
      const style = getComputedStyle(svg)
      const axis = (offset: number, max: number, before: 'paddingLeft' | 'paddingTop', after: 'paddingRight' | 'paddingBottom') => {
        if (offset < 0) svg.style[before] = `${Number.parseFloat(style[before]) - offset}px`
        else if (offset > max) svg.style[after] = `${Number.parseFloat(style[after]) + offset - max}px`
        return Math.max(0, offset)
      }
      const left = axis(
        element.scrollLeft + drawn.x + (at.x - bounds.minX) * scale - wanted.x,
        element.scrollWidth - element.clientWidth,
        'paddingLeft',
        'paddingRight',
      )
      const top = axis(
        element.scrollTop + drawn.y + (at.y - bounds.minY) * scale - wanted.y,
        element.scrollHeight - element.clientHeight,
        'paddingTop',
        'paddingBottom',
      )
      element.scrollLeft = left
      element.scrollTop = top
      const settled = drawingOrigin(element, svg)
      const error = Math.max(
        Math.abs(settled.x + (at.x - bounds.minX) * scale - wanted.x),
        Math.abs(settled.y + (at.y - bounds.minY) * scale - wanted.y),
      )
      if (error < 0.5) break
    }
    keep()
    record()
  })
}
