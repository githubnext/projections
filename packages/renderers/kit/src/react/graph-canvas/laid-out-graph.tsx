// The graph drawn for one laid-out transition.
import {useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject} from 'react'
import {entityLabels} from '@githubnext/projections-renderer-sdk/presentation'
import type {RendererFocus} from '@githubnext/projections-renderer-sdk/protocol'
import {emphasisInset} from '../../border.js'
import {graphEntityLimit, type GraphAnchor} from './props.js'
import {drawing, type LaidOutGraphProps} from './drawing.js'
import {useFraming, useGraphZoom, type Bounds} from './framing.js'
import {focusArea, type FocusArea} from '../../graph-canvas/focus.js'
import {boundariesHoldingChanges} from '../../graph-canvas/holds-changes.js'
import {EntityCard} from './entity-card.js'
import {GraphFooter} from './graph-footer.js'
import {Arrowheads, drawnLinks, GraphLink} from './graph-link.js'
import {GroupNode} from './group-node.js'
import type {GraphFrame, GraphTransition, TransitionEdge} from '../../graph-transition.js'
import type {Point} from '../../edge-arrows.js'
import {morphFrames, shiftFrame, viewChangeMs} from '../../graph-canvas/view-change.js'

/** The scope key while the host hasn't said what it shows. */
const provisional = 'provisional'

/** What was drawn last: the frame, where it was framed and at what scale. */
interface Shown {
  transition: GraphTransition
  frame: GraphFrame
  bounds: Bounds
  scale: number
}

/** A card's top left corner, layout units. */
const corner = (node: {x: number; y: number; width: number; height: number}): Point => ({
  x: node.x - node.width / 2,
  y: node.y - node.height / 2,
})

export function LaidOutGraph(props: LaidOutGraphProps) {
  const {progress, onSelect, comparing, transition, orientation, count} = props
  const diff = props.diff && props.comparing
  // One frame per progress: what was drawn last (below) compares frames by identity.
  const target = useMemo(() => (diff ? transition.diff : transition(progress)), [diff, transition, progress])
  const {framing, bounds, flush} = useFraming(transition, diff)
  const scroller = useRef<HTMLDivElement>(null)
  // What was drawn last, as of the last render: a new view moves from it.
  const [drawnLast, setDrawnLast] = useState<Drawn>()
  // The scope the layout shows: changing it (Changes and All) moves the cards between the two layouts.
  // Before the host's filter, every item is drawn provisionally: the first scope it chooses is drawn at once.
  const scopeKey = props.filtered === false ? provisional : props.scope ? `changes:${props.scope.shown.size}` : 'all'
  const {frame, hold, overflow, change} = useViewChange(
    scroller,
    drawnLast,
    props.anchor,
    transition,
    target,
    props.reducedMotion,
    scopeKey,
  )
  const nodes = frame.nodes
  const nodeById = new Map(nodes.map(node => [node.id, node]))
  // A relationship's endpoints are named from the revision it comes from.
  const labelsIn = useMemo(() => ({before: entityLabels(props.model.before), after: entityLabels(props.model.after)}), [props.model])
  const edges = frame.edges.filter(edge => !edge.containment && nodeById.has(edge.fromId) && nodeById.has(edge.toId))
  const shared = edges.filter(edge => edge.shared)
  const [sharedOpen, setSharedOpen] = useState(false)
  const inspectEdge = (edge: TransitionEdge) => {
    if (edge.shared) setSharedOpen(true)
    else onSelect(edge.id)
  }
  const shown = props.scope?.shown
  // A layout drawn while the current props are laid out may hold items the new focus doesn't name, or more: framing
  // that focus within it would zoom the old drawing past its fit. Until its own layout arrives, it keeps the focus it
  // opened on, so its view doesn't move.
  const stale = props.stale === true
  const [opened, setOpened] = useState<{area: FocusArea | undefined; request: RendererFocus | undefined}>()
  const kept = stale ? opened : undefined
  const request = kept ? kept.request : props.focusRequest
  const area = useMemo(
    () => (kept ? kept.area : focusArea(transition, diff, props.model, request, shown)),
    [kept, transition, diff, props.model, request, shown],
  )
  if (!stale && (!opened || opened.area !== area || opened.request !== request)) setOpened({area, request})
  const drawn = nodes.map(node => ({x: node.x - node.width / 2, y: node.y - node.height / 2, width: node.width, height: node.height}))
  const {zoom, scale, borders, keep, top, bottom} = useGraphZoom(
    scroller,
    framing,
    bounds,
    props.onAction,
    {area, request},
    orientation,
    drawn,
    hold,
  )
  if (drawnLast?.transition !== transition || drawnLast.target !== target || drawnLast.bounds !== bounds || drawnLast.scale !== scale) {
    setDrawnLast({transition, target, bounds, scale})
  }
  useAnchoredScroll(scroller, change, transition, target, bounds, scale, keep)
  const draw = drawing(props, diff, emphasisInset(borders), borders.normal)
  const caption = props.focus ? props.focus.label : ''
  const links = drawnLinks(edges, nodeById, draw, labelsIn, borders)
  const holding = boundariesHoldingChanges(nodes, edges, props.emphasis)
  return (
    <div className="graph-container" data-diff={diff ? '' : undefined}>
      {count > graphEntityLimit && (
        <p className="graph-notice" role="status">
          Showing {graphEntityLimit} of {count} entities. Use a narrower projection or the host's table to see every entity.
        </p>
      )}
      <div
        className="graph-scroll pk-dot-grid"
        data-projections-scroll="graph"
        role="region"
        aria-label="Scrollable graph"
        tabIndex={0}
        ref={scroller}
        data-zoom={zoom}
        style={{'--pk-fit-top': `${top}px`, '--pk-fit-bottom': `${bottom}px`} as CSSProperties}
      >
        {!nodes.length ? (
          <div className="empty-state" role="status">
            <h3>{comparing ? 'No entities at this point' : 'No entities to show'}</h3>
            <p>{comparing ? 'Move the timeline to see the other state.' : 'This extraction has no entities.'}</p>
          </div>
        ) : (
          <svg
            className="graph"
            role="group"
            aria-label={`Graph, ${nodes.length} entities`}
            data-orientation={orientation}
            viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
            data-scale={scale}
            style={{
              width: `${bounds.width * scale}px`,
              height: `${bounds.height * scale}px`,
              visibility: scale ? undefined : 'hidden',
              // Flush with the host's stage inset, strokes past the outermost cards draw in the drawing's padding.
              ...(overflow || flush ? {overflow: 'visible'} : {}),
            }}
          >
            {nodes
              .filter(node => node.group)
              .map(node => (
                <GroupNode key={node.id} node={node} drawing={draw} holdsChanges={holding.has(node.id)} />
              ))}
            {links.map(link => (
              <GraphLink key={link.edge.key} link={link} drawing={draw} sharedOpen={sharedOpen} inspect={inspectEdge} />
            ))}
            {keyed(frame.junctions, point => `${point.x},${point.y}`).map(([key, point]) => (
              <circle key={key} className="graph-junction" cx={point.x} cy={point.y} r="2.5" aria-hidden="true" />
            ))}
            {nodes
              .filter(node => !node.group)
              .map(node => (
                <EntityCard key={node.id} node={node} drawing={draw} />
              ))}
            <Arrowheads links={links} drawing={draw} junctions={frame.junctions} />
          </svg>
        )}
      </div>
      <GraphFooter
        caption={caption}
        shared={shared}
        nodeById={nodeById}
        sharedOpen={sharedOpen}
        setSharedOpen={setSharedOpen}
        onSelect={onSelect}
      />
    </div>
  )
}

/** What `useViewChange` hands `useAnchoredScroll`: where the card in the activated one's place should be on screen. */
interface ViewChange {
  pending: {to: string; screen: Point} | undefined
}

/**
 * A new view of the same document laid out after the person activated a card (`anchor`, see `GraphAnchor`): keeps the
 * drawn scale (`hold`, for `useGraphZoom`), notes where the activated card is on screen (`change`, for
 * `useAnchoredScroll`), and returns the frames that move the cards there from the old view, which may reach outside
 * the new view's bounds while they move (`overflow`). Without an anchor, or for the first view, it returns `target`.
 */
function useViewChange(
  scroller: RefObject<HTMLDivElement | null>,
  anchor: GraphAnchor | undefined,
  transition: GraphTransition,
  target: GraphFrame,
  bounds: Bounds,
  scale: RefObject<number>,
  reducedMotion: boolean,
  scopeKey: string,
) {
  const shown = useRef<Shown>(undefined)
  const scoped = useRef(scopeKey)
  const rescoped = useRef(false)
  const used = useRef<GraphAnchor>(undefined)
  const held = useRef<{key: unknown; scale: number}>(undefined)
  const change = useRef<ViewChange>({pending: undefined}).current
  const [morph, setMorph] = useState<{from: GraphFrame; to: GraphTransition; mix: number}>()
  const previous = shown.current
  if (previous && previous.transition !== transition && anchor && anchor !== used.current) {
    used.current = anchor
    held.current = {key: anchor, scale: previous.scale}
    const was = previous.frame.nodes.find(node => node.id === anchor.from)
    const now = target.nodes.find(node => node.id === anchor.to)
    const element = scroller.current
    const svg = element?.querySelector<SVGSVGElement>('svg.graph')
    if (was && now && element && svg) {
      // Where the activated card is on screen now, read before the new view is drawn.
      const origin = drawingOrigin(element, svg)
      const from = corner(was),
        to = corner(now)
      change.pending = {
        to: anchor.to,
        screen: {
          x: origin.x + (from.x - previous.bounds.minX) * previous.scale,
          y: origin.y + (from.y - previous.bounds.minY) * previous.scale,
        },
      }
      // The old view, moved so the activated card is where its replacement is: that card stays put while the rest move.
      const start = shiftFrame(previous.frame, {x: to.x - from.x, y: to.y - from.y})
      setMorph(reducedMotion ? undefined : {from: start, to: transition, mix: 0})
    }
  }
  // A new scope lays the document out again: the cards move from the old layout to the new one, those it adds or leaves
  // out fading in or out, rather than jumping. The layout arrives after the scope does (it's laid out in the
  // background), so the change waits for it.
  if (scoped.current !== scopeKey) {
    rescoped.current = scoped.current !== provisional
    scoped.current = scopeKey
  }
  if (previous && previous.transition !== transition && rescoped.current) {
    rescoped.current = false
    if (!reducedMotion) setMorph({from: previous.frame, to: transition, mix: 0})
  }
  const moving = morph?.to === transition && morph.mix < 1
  const frame = moving ? morphFrames(morph.from, target, morph.mix) : target
  const moved = morph?.from
  useEffect(() => {
    const view = scroller.current?.ownerDocument.defaultView
    if (!moved || !view) return undefined
    let started: number | undefined
    let request = 0
    const tick = (time: number) => {
      started ??= time
      const mix = Math.max(1e-6, Math.min(1, (time - started) / viewChangeMs))
      setMorph(current => (current?.from === moved ? {...current, mix} : current))
      if (mix < 1) request = view.requestAnimationFrame(tick)
    }
    request = view.requestAnimationFrame(tick)
    return () => view.cancelAnimationFrame(request)
  }, [moved, scroller])
  useLayoutEffect(() => {
    shown.current = {transition, frame, bounds, scale: scale.current}
  })
  return {frame, hold: held.current, overflow: moving, change}
}

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
function useAnchoredScroll(
  scroller: RefObject<HTMLDivElement | null>,
  change: ViewChange,
  transition: GraphTransition,
  target: GraphFrame,
  bounds: Bounds,
  scale: number,
  keep: () => void,
) {
  const laid = useRef(transition)
  useLayoutEffect(() => {
    const element = scroller.current
    const svg = element?.querySelector<SVGSVGElement>('svg.graph')
    if (!element || !svg) return
    const wanted = change.pending
    const now = wanted && scale ? target.nodes.find(node => node.id === wanted.to) : undefined
    if (!wanted || !now) {
      // Room added for an earlier view goes with the next one.
      if (laid.current !== transition && !wanted) for (const side of sides) svg.style[side] = ''
      laid.current = transition
      return
    }
    change.pending = undefined
    laid.current = transition
    for (const side of sides) svg.style[side] = ''
    const at = corner(now)
    // Until it is there: room added on one side of a drawing narrower than its view, which is centred in it, moves the
    // drawing only half as far.
    for (let pass = 0; pass < 12; pass++) {
      const origin = drawingOrigin(element, svg)
      const style = getComputedStyle(svg)
      const axis = (offset: number, max: number, before: 'paddingLeft' | 'paddingTop', after: 'paddingRight' | 'paddingBottom') => {
        if (offset < 0) svg.style[before] = `${Number.parseFloat(style[before]) - offset}px`
        else if (offset > max) svg.style[after] = `${Number.parseFloat(style[after]) + offset - max}px`
        return Math.max(0, offset)
      }
      const left = axis(
        element.scrollLeft + origin.x + (at.x - bounds.minX) * scale - wanted.screen.x,
        element.scrollWidth - element.clientWidth,
        'paddingLeft',
        'paddingRight',
      )
      const top = axis(
        element.scrollTop + origin.y + (at.y - bounds.minY) * scale - wanted.screen.y,
        element.scrollHeight - element.clientHeight,
        'paddingTop',
        'paddingBottom',
      )
      element.scrollLeft = left
      element.scrollTop = top
      const placed = drawingOrigin(element, svg)
      const error = Math.max(
        Math.abs(placed.x + (at.x - bounds.minX) * scale - wanted.screen.x),
        Math.abs(placed.y + (at.y - bounds.minY) * scale - wanted.screen.y),
      )
      if (error < 0.5) break
    }
    keep()
  })
}
