// The graph's frame: every layout the transition passes through, its bounds, and the stage's fit and zoom.
import {useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {RefObject} from 'react'
import type {RendererFocus} from '@githubnext/projections-renderer-sdk/protocol'
import type {GraphTransition} from '../../graph-transition.js'
import {contentStart, openingZoom} from '../../zoom.js'
import {useBorderWidths} from '../border.js'
import {useFitScale} from '../fit.js'
import {useFrameSizing, useStageInset, useStageInsetTop} from '../shell/frame.js'
import {useOpeningFloor, useStageZoom} from '../zoom.js'
import type {ContentBox, ScrollStart} from '../../zoom.js'
import type {LaidOutGraphProps} from './drawing.js'
import type {FocusArea} from '../../graph-canvas/focus.js'

/** Space between the frame and a fitted graph, CSS px, unless the host sets a `stage-inset` across. */
const graphPadding = 16
/** Room for strokes, rings and arrowheads past the cards, content units. */
const strokeRoom = 12

/**
 * The space around a fitted graph, CSS px: `graphPadding`, or across the host's `stage-inset` (`styles/graph.css`
 * pads the drawing the same), where the drawing's sides then reach exactly to the outermost cards and routes (see
 * `useFraming`), so they line up with the host's column; and above it the host's `stage-inset-top`, where it sends
 * one, so the graph opens below what the host overlays on the frame's top.
 */
export function useGraphPadding(): GraphPadding {
  const x = useStageInset() ?? graphPadding
  const top = useStageInsetTop() ?? graphPadding
  return useMemo(() => ({x, y: graphPadding, top}), [x, top])
}

/** The space around a fitted graph, CSS px: across, below, and above it (`useGraphPadding`). */
export interface GraphPadding {
  x: number
  y: number
  top: number
}

export interface Bounds {
  minX: number
  minY: number
  width: number
  height: number
}

/**
 * Framing covers every layout the transition passes through, never the current frame, so the view never zooms while
 * scrubbing.
 */
export function useFraming(transition: GraphTransition, diff: boolean) {
  // With the host's stage inset the drawing reaches exactly to its outermost cards and routes across, its strokes
  // drawn past them in the inset (the drawing's overflow shows), so the cards line up with the host's column.
  const across = useStageInset() === undefined ? strokeRoom : 0
  const framing = useMemo(() => {
    if (diff) {
      const {nodes, edges} = transition.diff
      return {
        boxes: nodes.map(node => ({x: node.x, y: node.y, width: node.width, height: node.height})),
        points: edges.flatMap(edge => edge.points),
      }
    }
    const layouts = transition.layouts.filter(layout => layout.points.size)
    if (!layouts.length) return undefined
    const boxes = layouts.flatMap(layout => [...layout.points].map(([id, point]) => ({...point, ...layout.sizes.get(id)!})))
    const points = layouts.flatMap(layout => [...layout.routes.values()].flat())
    return {boxes, points}
  }, [transition, diff])
  const bounds = useMemo((): Bounds => {
    if (!framing) return {minX: 0, minY: 0, width: 760, height: 420}
    const {boxes, points} = framing
    const left = Math.min(...boxes.map(box => box.x - box.width / 2), ...points.map(point => point.x)) - across
    const right = Math.max(...boxes.map(box => box.x + box.width / 2), ...points.map(point => point.x)) + across
    const top = Math.min(...boxes.map(box => box.y - box.height / 2), ...points.map(point => point.y)) - strokeRoom
    const bottom = Math.max(...boxes.map(box => box.y + box.height / 2), ...points.map(point => point.y)) + strokeRoom
    return {minX: left, minY: top, width: right - left, height: bottom - top}
  }, [framing, across])
  return {framing, bounds, flush: across === 0}
}

/**
 * Fit (everything in view) is the least zoom and the opening view, unless it would draw text below the kit's opening
 * floor: then the view opens at the floor on the top row of the cards it draws (`drawn`) and scrolls, centred across a
 * graph laid out top to bottom (whose layers spread out from the middle) where that row fits the view, from the
 * leftmost card of one laid out left to right or whose top row doesn't fit, never cutting a card at its left or top
 * edge (see `contentStart`). A focus (`area`, see
 * `focusArea`) opens on its area instead: fitted to it, at most at full size and, unless `request.fit`, no smaller
 * than the floor, where it opens on the area's reading start. Diff mode's own focus on its changes applies only when
 * everything doesn't fit at the floor: fitted to the changes when that keeps text at the floor, else at the floor on
 * the part of them that fills the view most, with the view's edges between cards rather than through them (see
 * `uncutStart`). `request.fit`
 * without an area fits everything whatever the floor. Zoom
 * enlarges it. All of it comes from the framing (every layout the transition passes through), so the scale only
 * changes with the frame, never while scrubbing. `hold` keeps a drawn scale across a new layout (see
 * `StageZoomOptions.hold`). Also reads the theme's border widths.
 */
export function useGraphZoom(
  scroller: RefObject<HTMLDivElement | null>,
  framing: ReturnType<typeof useFraming>['framing'],
  bounds: Bounds,
  onAction: LaidOutGraphProps['onAction'],
  focus: {area: FocusArea | undefined; request: RendererFocus | undefined} = {area: undefined, request: undefined},
  orientation: 'vertical' | 'horizontal' = 'vertical',
  drawn: readonly ContentBox[] = [],
  hold?: {key: unknown; scale: number},
) {
  const {area, request} = focus
  const floor = useOpeningFloor(scroller, framing)
  const padding = useGraphPadding()
  const flush = useStageInset() !== undefined
  // The scale drawn last: zoomed in, a content-sized stage grows to it (see `FitOptions.drawnScale`).
  const [drawnScale, setDrawnScale] = useState(0)
  const fit = useFitScale(scroller, bounds, {
    padding,
    floor,
    drawnScale,
    ...(area && request ? {aspect: (area.box.width + 2 * padding.x) / (area.box.height + padding.top + padding.y)} : {}),
  })
  // Arrowheads stop on the outer edge of their target's border; a change border is inset so it never reaches further.
  const borders = useBorderWidths(scroller)
  const content = useMemo((): ContentBox => ({x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height}), [bounds])
  // The view opens on the start of the cards drawn when it is placed (not those that only another moment of the
  // transition draws), read when it is placed, so the start never changes, nor the view moves, while scrubbing.
  const shown = useRef(drawn)
  shown.current = drawn
  const start = useMemo((): ScrollStart => {
    const all = (framing?.boxes ?? []).map(box => ({
      x: box.x - box.width / 2,
      y: box.y - box.height / 2,
      width: box.width,
      height: box.height,
    }))
    const align = orientation === 'vertical' ? 'centre' : 'left'
    // Flush with the host's stage inset, the leftmost card opens that inset from the view's edge.
    return view => contentStart(shown.current.length ? shown.current : all, content, padding, 12, align, flush ? padding.x : 0)(view)
  }, [framing, content, orientation, padding, flush])
  const sized = useFrameSizing() === 'content'
  const opening = useMemo(
    () =>
      focusOpening({
        area,
        request,
        floor,
        content,
        fit: fit.scale,
        view: {width: fit.width, height: fit.height},
        sized,
        orientation,
        padding,
      }),
    [area, request, floor, content, fit.scale, fit.width, fit.height, sized, orientation, padding],
  )
  const zoom = useStageZoom(scroller, onAction, fit.scale, {floor, start, ...(opening ? {opening} : {}), ...(hold ? {hold} : {})})
  useLayoutEffect(() => setDrawnScale(zoom.scale), [zoom.scale])
  return {...zoom, borders}
}

/** The opening view on a focus (see `useGraphZoom`), or undefined for the default one. */
function focusOpening({
  area,
  request,
  floor,
  content,
  fit,
  view,
  sized,
  orientation,
  padding,
}: {
  area: FocusArea | undefined
  request: RendererFocus | undefined
  floor: number
  content: ContentBox
  fit: number
  view: {width: number; height: number}
  /** Whether the host sizes the frame to the content, which it measures at the floor. */
  sized: boolean
  orientation: 'vertical' | 'horizontal'
  /** The space around the fitted graph (`useGraphPadding`). */
  padding: GraphPadding
}): {zoom: number; start: ScrollStart} | undefined {
  if (!fit) return undefined
  if (!area) return request?.fit ? {zoom: 1, start: {x: 0, y: 0}} : undefined
  // Diff mode's own focus: only when everything doesn't fit at the floor.
  if (!request && openingZoom(fit, floor) <= 1) return undefined
  const {box} = area
  const room = Math.min(
    Math.max(0, view.width - 2 * padding.x) / box.width,
    Math.max(0, view.height - padding.top - padding.y) / box.height,
  )
  const fitted = Math.min(1, room)
  // Asked for, the area is fitted (at most at full size, and not below the floor unless `fit`). Diff mode's own focus
  // fits its changes too where that keeps text at the floor, else stays at the floor; in a content-sized frame, which
  // takes the content's height at the floor, it stays there.
  const scale = Math.max(fit, request?.fit ? fitted : request || !sized ? Math.max(fitted, floor) : floor)
  const fits = fitted >= scale * (1 - 1e-6)
  const centred: ScrollStart = ({scale, width, height}) => ({
    left: (box.x + box.width / 2 - content.x) * scale + padding.x - width / 2,
    top: (box.y + box.height / 2 - content.y) * scale + padding.top - height / 2,
  })
  // Asked for: centred where the area fits, else its reading start, as the whole graph opens.
  if (request) return {zoom: scale / fit, start: fits ? centred : contentStart(area.cards, content, padding)}
  // Diff mode's own focus: centred on its changes where they fit; else on the part of the view's size that holds the
  // most of them, the first such along the layers (the top of a graph laid out top to bottom).
  const reading: ScrollStart = view => {
    const corner = busiestWindow(area.cards, {width: view.width / view.scale, height: view.height / view.scale}, orientation)
    return {
      left: (corner.x - content.x) * view.scale + padding.x,
      top: (corner.y - content.y) * view.scale + padding.top,
    }
  }
  return {zoom: scale / fit, start: uncutStart(fits ? centred : reading, area, content, fits, padding)}
}

/**
 * The top left corner, content units, of a window of `size` that holds the most of `cards` whole: each card's corner
 * (less a margin) is a candidate on each axis. Of equally full ones, the first along the layers, then across them.
 */
function busiestWindow(
  cards: readonly ContentBox[],
  size: {width: number; height: number},
  orientation: 'vertical' | 'horizontal',
): {x: number; y: number} {
  const xs = [...new Set(cards.map(card => card.x - edgeMargin))],
    ys = [...new Set(cards.map(card => card.y - edgeMargin))]
  let best = {x: xs[0] ?? 0, y: ys[0] ?? 0, count: -1}
  const earlier = (x: number, y: number) =>
    orientation === 'vertical' ? y < best.y || (y === best.y && x < best.x) : x < best.x || (x === best.x && y < best.y)
  for (const x of xs)
    for (const y of ys) {
      const count = cards.filter(
        card => card.x >= x && card.y >= y && card.x + card.width <= x + size.width && card.y + card.height <= y + size.height,
      ).length
      if (count > best.count || (count === best.count && earlier(x, y))) best = {x, y, count}
    }
  return best
}

/** Room left between a view's edge and a card it no longer cuts, content units. */
const edgeMargin = 8

/**
 * A start moved from `start` so that no card in `area.drawn` straddles an edge of the view, where it can: on each axis,
 * the offset nearest the given one at which the cards the view reaches on the other axis are cut least, within the
 * scroll range. Where some must be cut (a layout too dense for the view), a changed card (`area.cards`) is cut last,
 * then one at the edge reading starts from (the left or top). Where the area fits (`fits`) it stays wholly in view;
 * otherwise it moves at most a quarter of the view.
 */
function uncutStart(start: ScrollStart, area: FocusArea, content: ContentBox, fits: boolean, padding: GraphPadding): ScrollStart {
  return view => {
    const at = typeof start === 'function' ? start(view) : {left: 0, top: 0}
    const {scale} = view
    if (!scale) return at
    // An axis's padding before the content and its padding before and after it together.
    type Axis = {position: 'x' | 'y'; size: 'width' | 'height'; extent: number; before: number; padding: number}
    const horizontal: Axis = {position: 'x', size: 'width', extent: view.width, before: padding.x, padding: 2 * padding.x},
      vertical: Axis = {position: 'y', size: 'height', extent: view.height, before: padding.top, padding: padding.top + padding.y}
    const origin = (axis: Axis) => content[axis.position] - axis.before / scale
    // The view's span on an axis, in content units, from a scroll offset.
    const span = (axis: Axis, offset: number) => [origin(axis) + offset / scale, origin(axis) + (offset + axis.extent) / scale] as const
    const place = (axis: Axis, offset: number, other: Axis, otherOffset: number) => {
      const [from, to] = span(axis, offset)
      const width = to - from
      const range = [origin(axis), origin(axis) + content[axis.size] + axis.padding / scale - width] as const
      if (range[1] <= range[0]) return offset
      const [low, high] = span(other, otherOffset)
      const changed = new Set(area.cards.map(card => `${card.x},${card.y}`))
      const cards = area.drawn
        .filter(card => card[other.position] < high && card[other.position] + card[other.size] > low)
        .map(card => [card[axis.position], card[axis.position] + card[axis.size], changed.has(`${card.x},${card.y}`) ? 100 : 1] as const)
      const slack = fits ? Math.max(0, (width - area.box[axis.size]) / 2) : width / 4
      const candidates = [
        from,
        ...cards.flatMap(([start, end]) => [start - edgeMargin, end + edgeMargin, end + edgeMargin - width, start - edgeMargin - width]),
      ]
        .filter(value => Math.abs(value - from) <= slack + 1e-6)
        .map(value => Math.min(range[1], Math.max(range[0], value)))
      const cut = (start: number, end: number, edge: number) => start < edge - 0.5 && edge + 0.5 < end
      const cuts = (value: number) =>
        cards.reduce(
          (cost, [start, end, weight]) => cost + (cut(start, end, value) ? 2 * weight : cut(start, end, value + width) ? weight : 0),
          0,
        )
      const best = candidates.reduce((chosen, value) => {
        const [a, b] = [cuts(value), cuts(chosen)]
        return a < b || (a === b && Math.abs(value - from) < Math.abs(chosen - from)) ? value : chosen
      })
      return (best - origin(axis)) * scale
    }
    // Each axis counts the cards the view reaches on the other; the first is placed again once the second is.
    const top = place(vertical, at.top, horizontal, at.left)
    const left = place(horizontal, at.left, vertical, top)
    return {left, top: place(vertical, at.top, horizontal, left)}
  }
}
