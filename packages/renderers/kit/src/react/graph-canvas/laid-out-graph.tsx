// The graph drawn for one laid-out transition.
import {useMemo, useRef, useState} from 'react'
import type {CSSProperties} from 'react'
import {entityLabels, keyed} from '@githubnext/projections-renderer-sdk/presentation'
import type {RendererFocus} from '@githubnext/projections-renderer-sdk/protocol'
import {emphasisInset} from '../../border.js'
import {graphEntityLimit} from './props.js'
import {drawing} from './drawing.js'
import type {LaidOutGraphProps} from './drawing.js'
import {useFraming, useGraphZoom} from './framing.js'
import {focusArea} from '../../graph-canvas/focus.js'
import type {FocusArea} from '../../graph-canvas/focus.js'
import {boundariesHoldingChanges} from '../../graph-canvas/holds-changes.js'
import {EntityCard} from './entity-card.js'
import {GraphFooter} from './graph-footer.js'
import {Arrowheads, drawnLinks, GraphLink} from './graph-link.js'
import {GroupNode} from './group-node.js'
import type {TransitionEdge} from '../../graph-transition.js'
import {provisional, useViewChange} from './moving-view.js'
import type {Drawn} from './moving-view.js'
import {useAnchoredScroll} from './anchored-scroll.js'

export function LaidOutGraph(props: LaidOutGraphProps) {
  const {progress, onSelect, comparing, transition, orientation, count} = props
  const diff = props.diff && props.comparing
  const target = diff ? transition.diff : transition(progress)
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
