// A relationship as drawn: its hit target, halo and emphasised line, and its arrowhead over the cards.
import {relationshipLabel} from '@githubnext/projections-renderer-sdk/presentation'
import type {Relationship} from '@githubnext/projections-schemas'
import {arrowHeadStyle} from '../../arrowhead.js'
import {cardBorderOutset} from '../../border.js'
import type {BorderWidths} from '../../border.js'
import {classifyChange, edgePaint} from '../../emphasis.js'
import type {ChangeClassification} from '../../emphasis.js'
import type {TransitionEdge, TransitionNode} from '../../graph-transition.js'
import {changeMark} from '../../diff/model.js'
import {drawnEdge} from '../../graph-canvas/edges.js'
import type {Point} from '../../edge-arrows.js'
import {edgeDescription} from './drawing.js'
import type {Drawing} from './drawing.js'

/** The default for an optional list prop: one array, so a default never changes between renders. */
const none: readonly never[] = []

export interface DrawnLink {
  edge: TransitionEdge
  arrow: ReturnType<typeof drawnEdge>
  relationship: Relationship
  name: string
  emphasis: number
  change: ChangeClassification
  paint: ReturnType<typeof edgePaint>
}

/** Each relationship's route, name, change and paint as drawn now. */
export function drawnLinks(
  edges: readonly TransitionEdge[],
  nodeById: ReadonlyMap<string, TransitionNode>,
  drawing: Drawing,
  labelsIn: {before: (id: string) => string | undefined; after: (id: string) => string | undefined},
  borders: BorderWidths,
): DrawnLink[] {
  // In the diff a rewired relationship is drawn twice: its old route is removed and its new one added.
  const edgeChange = (edge: TransitionEdge): ChangeClassification =>
    edge.part === 'before' ? 'removed' : edge.part === 'after' ? 'added' : classifyChange(edge)
  return edges.map(edge => {
    const relationship =
      edge.part === 'before' ? edge.before! : edge.local < 0.5 ? (edge.before ?? edge.after!) : (edge.after ?? edge.before!)
    const emphasis = drawing.props.emphasis(edge)
    const change = edgeChange(edge)
    return {
      edge,
      arrow: drawnEdge(edge, nodeById.get(edge.fromId)!, nodeById.get(edge.toId)!, cardBorderOutset(borders)),
      relationship,
      name: relationshipLabel(relationship, relationship === edge.after ? labelsIn.after : labelsIn.before),
      emphasis,
      change,
      paint: edgePaint(
        change === 'renamed' ? {status: 'unchanged', renamed: true} : {status: change},
        emphasis,
        1.3,
        drawing.props.relationshipColor?.(relationship),
      ),
    }
  })
}

export function GraphLink({
  link,
  drawing,
  sharedOpen,
  inspect,
}: {
  link: DrawnLink
  drawing: Drawing
  sharedOpen: boolean
  inspect: (edge: TransitionEdge) => void
}) {
  const {edge, arrow, relationship, name, emphasis, change, paint} = link
  const {props, diff, receded} = drawing
  const menu = edge.shared
  // A selected or hovered card's relationships are traced whole, however many others they run beside.
  const incident = [props.selectedId, props.hoveredId].some(id => id !== null && (id === edge.fromId || id === edge.toId))
  // A relationship's annotation badge sits at its target end, clear of the source card's status footer.
  return (
    <g
      className={`graph-link${props.focus && (receded(edge.fromId) || receded(edge.toId)) ? ' receded' : ''}`}
      opacity={edge.opacity}
      {...(props.synthetic?.(edge.id) ? {'data-graph-synthetic': edge.id} : {'data-entity-id': edge.id})}
      data-edge-key={edge.key}
      {...(diff ? changeMark(change) : {})}
      data-projections-annotation-anchor="bottom-right"
      data-from={edge.fromId}
      data-to={edge.toId}
      data-incident={incident ? '' : undefined}
      data-end={`${arrow.tip.x},${arrow.tip.y}`}
    >
      <path
        d={arrow.d}
        className="edge-hit"
        role="button"
        tabIndex={0}
        aria-haspopup={menu ? 'menu' : undefined}
        aria-expanded={menu ? sharedOpen : undefined}
        aria-label={`Inspect relationship ${name}${props.comparing ? `, ${edgeDescription(edge)}` : ''}`}
        onClick={() => inspect(edge)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            inspect(edge)
          }
        }}
      >
        <title>{name}</title>
      </path>
      <g className="graph-edge-halo" aria-hidden="true">
        <path d={arrow.d} />
      </g>
      {/* Emphasis is this path's own stroke, ending at the arrowhead's base like the shaft. */}
      <path
        d={arrow.d}
        data-projections-edge="line"
        className={`graph-edge ${relationship.confidence === 'inferred' ? 'inferred' : ''} ${emphasis > 0.01 ? `graph-edge-emphasis ${change}` : ''}`}
        style={paint}
        strokeDasharray={emphasis > 0.01 && change === 'removed' ? '5 3' : undefined}
      />
    </g>
  )
}

/** The junction a relationship routed through a shared-prerequisite stage passes, if it is drawn. */
function junctionOf(edge: TransitionEdge, junctions: readonly Point[]): Point | undefined {
  if (!edge.shared) return undefined
  return junctions.find(junction => edge.points.some(point => Math.hypot(point.x - junction.x, point.y - junction.y) < 1))
}

/**
 * Arrowheads are drawn over the cards, so a tip on a card's face sits on top of its border. Each also carries a clear
 * copy of its relationship's junction dot, which the SDK fills in the ring's color while the relationship is hovered,
 * focused or selected: a junction is shared by every relationship through it, so the one drawn junction can't be
 * any single relationship's edge.
 */
export function Arrowheads({
  links,
  drawing,
  junctions = none,
}: {
  links: readonly DrawnLink[]
  drawing: Drawing
  junctions?: readonly Point[]
}) {
  const {props, receded} = drawing
  return (
    <g className="graph-arrowheads" aria-hidden="true">
      {links.map(({edge, arrow, paint}) => (
        <g
          key={edge.key}
          className={`graph-link-head${props.focus && (receded(edge.fromId) || receded(edge.toId)) ? ' receded' : ''}`}
          opacity={edge.opacity}
          data-edge-key={edge.key}
          data-head-of={edge.id}
          {...(props.synthetic?.(edge.id) ? {} : {'data-projections-ring-with': edge.id})}
        >
          <path
            d={arrow.head}
            className="graph-arrowhead"
            data-projections-edge="fill"
            style={arrowHeadStyle(paint.stroke)}
            data-direction={`${arrow.direction.x},${arrow.direction.y}`}
            data-base={`${arrow.base.x},${arrow.base.y}`}
          />
          {(() => {
            const junction = junctionOf(edge, junctions)
            return (
              junction && <circle className="graph-junction-ring" data-projections-edge="fill" cx={junction.x} cy={junction.y} r="2.5" />
            )
          })()}
        </g>
      ))}
    </g>
  )
}
