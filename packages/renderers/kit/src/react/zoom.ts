// Zooming and panning a fitted stage: the zoom actions, Ctrl/⌘-wheel and pinch, the scroll anchor, the text floor the
// view opens at and the dot grid behind the content.
import {useEffect, useLayoutEffect, useRef, useState, type RefObject} from 'react'
import {openingFloorPx} from '@githubnext/projections-renderer-sdk/presentation'
import {placedAttribute} from '../focus.js'
import {clampZoom, dotGrid, maxZoom, openingZoom, zoomLimits, type ScrollStart, type StageZoom, type StageZoomOptions} from '../zoom.js'
import {pageWheel, useDragPan} from './drag-pan.js'
import {useStageCover, useStageInsetTop} from './shell/frame.js'
import {useControlActions} from './shell/mount.js'
import type {RendererProps} from './shell/props.js'

const topLeft: ScrollStart = {x: 0, y: 0}

/** Input by which a person scrolls a view themselves. */
const inputEvents = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const
const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '])

/**
 * Keeps the point at the middle of a scroll container in the middle when the
 * content's scale changes (fit, zoom, resize). While `opening` (the person has
 * neither zoomed nor scrolled), content that overflows stays at `start` (by
 * default its top left, where reading begins) rather than cut through the middle.
 * `onMove` is called when the person first scrolls, drags, taps or presses a
 * scroll key in content that overflows: the moment they start to pan.
 * Returns a function that keeps the view where its caller just scrolled it.
 */
export function useScrollAnchor(
  scroller: RefObject<HTMLElement | null>,
  scale: number,
  opening = false,
  start: ScrollStart = topLeft,
  onMove?: () => void,
  clearCover = true,
): () => void {
  const center = useRef({x: 0.5, y: 0.5})
  // Whether the person has scrolled: only their own input counts, never a scroll the browser makes (clamping the
  // offset when the frame resizes) or the view's own placement.
  const moved = useRef(false)
  // Under a host's cover, a view that opens scrolled keeps the band the cover takes clear (`stage-inset-top`), so its
  // first row opens below the cover rather than under it; it still pans under it.
  const cover = useStageCover()
  const insetTop = useStageInsetTop()
  // Not for an opening centred on a focus (`clearCover` false), which the placement already centres in the view.
  const clear = clearCover && cover?.length !== undefined && cover.length > 0 ? (insetTop ?? 0) : 0
  const current = useRef({scale, opening, start, onMove, clear})
  current.current = {scale, opening, start, onMove, clear}
  // Places the view: at its start while it opens, else around the middle it had.
  const place = useRef((element: HTMLElement, recentre: boolean) => {
    const latest = current.current
    if (!latest.scale) return
    if (latest.opening && !moved.current) {
      const width = element.scrollWidth - element.clientWidth,
        height = element.scrollHeight - element.clientHeight
      if (typeof latest.start === 'function') {
        const {left, top} = latest.start({scale: latest.scale, width: element.clientWidth, height: element.clientHeight})
        element.scrollLeft = Math.max(0, Math.min(width, left))
        element.scrollTop = Math.max(0, Math.min(height, top - latest.clear))
      } else {
        element.scrollLeft = latest.start.x * width
        element.scrollTop = latest.start.y * height
      }
    } else if (recentre) {
      const {x, y} = center.current
      element.scrollLeft = x * element.scrollWidth - element.clientWidth / 2
      element.scrollTop = y * element.scrollHeight - element.clientHeight / 2
    } else return
    center.current = middle(element)
  }).current
  useEffect(() => {
    const element = scroller.current
    if (!element) return undefined
    // The view is placed here, so the shell's opening scroll (see `useOpeningReveal`) leaves it alone.
    element.setAttribute(placedAttribute, '')
    const onScroll = () => {
      center.current = middle(element)
    }
    const onInput = (event: Event) => {
      if (event instanceof KeyboardEvent && !scrollKeys.has(event.key)) return
      // A stage that pans by dragging lets the wheel scroll the host's page, which moves nothing here.
      if (pageWheel(event, element)) return
      moved.current = true
      // Content in view has nothing to pan: a click on a fitted card keeps the view following the frame.
      if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) current.current.onMove?.()
    }
    element.addEventListener('scroll', onScroll, {passive: true})
    for (const type of inputEvents) element.addEventListener(type, onInput, {passive: true})
    // While the view opens, a frame that settles to another size (a content-sized host answering the requested
    // height) keeps it at its start, rather than where the browser clamped it.
    const observer = new ResizeObserver(() => place(element, false))
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', onScroll)
      for (const type of inputEvents) element.removeEventListener(type, onInput)
      observer.disconnect()
    }
  }, [scroller, place])
  useLayoutEffect(() => {
    const element = scroller.current
    if (element) place(element, true)
  }, [scroller, scale, opening, start, clear, place])
  // The view as it is now is the one to keep: after its owner moves it, a later change keeps that middle.
  return useRef(() => {
    const element = scroller.current
    if (element) center.current = middle(element)
  }).current
}

function middle(element: HTMLElement): {x: number; y: number} {
  const fraction = (offset: number, client: number, extent: number) => (extent > client ? (offset + client / 2) / extent : 0.5)
  return {
    x: fraction(element.scrollLeft, element.clientWidth, element.scrollWidth),
    y: fraction(element.scrollTop, element.clientHeight, element.scrollHeight),
  }
}

/**
 * The scale at which the smallest text in `root` is drawn at `openingFloorPx`, or 0 before there is any: SVG text
 * and HTML text (including HTML in a `foreignObject`), whatever its opacity (text that fades in while scrubbing
 * counts), in content units, so `root` is the content the stage scales, whether by an SVG's size or a CSS transform.
 * Visually hidden HTML text (laid out at most 1 px wide or high, like `.sr-only`) doesn't count. Measured before paint
 * whenever `key` changes, for example the content's layout, never while scrubbing.
 */
export function useOpeningFloor(root: RefObject<Element | null>, key: unknown): number {
  const [scale, setScale] = useState(0)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    let smallest = Infinity
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.parentElement
      if (!text || !node.textContent?.trim() || !drawnText(text)) continue
      const size = parseFloat(getComputedStyle(text).fontSize)
      if (size > 0) smallest = Math.min(smallest, size)
    }
    const next = Number.isFinite(smallest) ? openingFloorPx / smallest : 0
    setScale(previous => (Math.abs(previous - next) < 1e-6 ? previous : next))
  }, [root, key])
  return scale
}

/** SVG text content, or HTML laid out larger than the 1 px box that visually hidden text uses. */
function drawnText(element: Element): boolean {
  const view = element.ownerDocument.defaultView
  if (view && element instanceof view.SVGTextContentElement) return true
  return Boolean(view && element instanceof view.HTMLElement && element.offsetWidth > 1 && element.offsetHeight > 1)
}

/**
 * Zoom for content fitted to the scroll container `scroller` at `fit` (see
 * `useFitScale`): the `zoomControls` actions, Ctrl/⌘-wheel and pinch in the
 * frame, and a scroll position that keeps its centre across scale changes.
 * The view opens fitted, with everything in view, unless that would draw its
 * smallest text below `openingFloorPx`: then it opens at `options.floor`,
 * scrolled to `options.start`, and the person pans the rest. Until the person
 * zooms or pans, a resize recomputes that opening from the new fit. Fit returns
 * to everything in view however small, and zooming out stops there, so
 * everything is always reachable. Once zoomed or panned, a resize keeps the
 * zoom multiple of the new fit.
 */
export function useStageZoom(
  scroller: RefObject<HTMLElement | null>,
  onAction: RendererProps['onAction'],
  fit: number,
  options: StageZoomOptions = {},
): StageZoom {
  // `undefined` until the person zooms or pans: the opening zoom, which follows the fit.
  const [chosen, setChosen] = useState<number>()
  const held = useRef<unknown>(undefined)
  if (options.hold && options.hold.key !== held.current && fit > 0 && options.hold.scale > 0) {
    held.current = options.hold.key
    const zoom = clampZoom(options.hold.scale / fit, fit)
    if (zoom !== chosen) setChosen(zoom)
  }
  const opening = options.opening ? clampZoom(options.opening.zoom, fit) : openingZoom(fit, options.floor ?? 0)
  const fitted = useRef(fit)
  fitted.current = fit
  const current = useRef(opening)
  current.current = chosen ?? opening
  useControlActions(onAction, {
    'zoom-in': () => setChosen(clampZoom(current.current * zoomLimits.step, fitted.current)),
    'zoom-out': () => setChosen(clampZoom(current.current / zoomLimits.step, fitted.current)),
    'zoom-fit': () => setChosen(1),
  })
  // A canvas gesture: Ctrl/⌘-wheel (and trackpad pinch, which browsers report the same way) zooms.
  // React's wheel listeners are passive, so this one is registered directly to be able to prevent page zoom.
  useEffect(() => {
    const element = scroller.current
    if (!element) return undefined
    const onWheel = (event: globalThis.WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      setChosen(clampZoom(current.current * Math.exp(-event.deltaY / 400), fitted.current))
    }
    element.addEventListener('wheel', onWheel, {passive: false})
    return () => element.removeEventListener('wheel', onWheel)
  }, [scroller])
  // Panning keeps the opening zoom: a later resize no longer recomputes it.
  const onMove = useRef(() => setChosen(previous => previous ?? current.current)).current
  // A larger stage raises the fit, which can lower the most a zoom may be.
  const shown = Math.min(chosen ?? opening, maxZoom(fit))
  const keep = useScrollAnchor(
    scroller,
    fit * shown,
    chosen === undefined,
    options.opening?.start ?? options.start,
    onMove,
    !options.opening?.centred,
  )
  useDotGrid(scroller, fit * shown)
  useDragPan(scroller)
  return {zoom: shown, scale: fit * shown, keep}
}

/**
 * Keeps `scroller`'s dot grid (`pk-dot-grid`, see `dotGrid`) on its content, the container's first element (an SVG
 * whose padding precedes its drawing, or a scaled box) drawn at `scale`, as the scale or the container's size moves
 * it. Panning needs nothing: the grid's background scrolls with the content.
 */
function useDotGrid(scroller: RefObject<HTMLElement | null>, scale: number): void {
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return undefined
    const place = () => {
      const content = element.firstElementChild
      const box = element.getBoundingClientRect()
      const origin = {x: 0, y: 0}
      if (content) {
        const drawn = content.getBoundingClientRect()
        const style = getComputedStyle(content)
        origin.x =
          drawn.left -
          box.left -
          element.clientLeft +
          element.scrollLeft +
          parseFloat(style.paddingLeft || '0') +
          parseFloat(style.borderLeftWidth || '0')
        origin.y =
          drawn.top -
          box.top -
          element.clientTop +
          element.scrollTop +
          parseFloat(style.paddingTop || '0') +
          parseFloat(style.borderTopWidth || '0')
      }
      const grid = dotGrid(scale, origin)
      const set = (name: string, value: string) => {
        if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value)
      }
      const px = (value: number) => `${Math.round(value * 1000) / 1000}px`
      set('--pk-grid-spacing', px(grid.spacing))
      // A tile's dot is at its centre: the tiles start half a spacing before each dot.
      set('--pk-grid-x', px(grid.x - grid.spacing / 2))
      set('--pk-grid-y', px(grid.y - grid.spacing / 2))
      set('--pk-grid-opacity', String(grid.opacity))
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [scroller, scale])
}
