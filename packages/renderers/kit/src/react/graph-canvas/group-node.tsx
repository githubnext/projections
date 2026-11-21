// A compound boundary: a dashed outline round its children, with its heading and status footer.
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import {classifyChange, mixedChange} from '../../emphasis.js'
import type {TransitionNode} from '../../graph-transition.js'
import {SvgChangeStatus} from '../components.js'
import {displayed, groupHeading} from './cards.js'
import {CardIcon} from './card-icon.js'
import {cardIconRoom, hasIcon} from '../../card-icons.js'
import type {Drawing} from './drawing.js'

/** `holdsChanges`: changes are drawn inside it, so it is drawn neutral (see `boundariesHoldingChanges`). */
export function GroupNode({node, drawing, holdsChanges = false}: {node: TransitionNode; drawing: Drawing; holdsChanges?: boolean}) {
  const {props, diff, inset, kindOf, statusOf, label, mark, select} = drawing
  const {selectedId, onSelect} = props
  const entity = displayed(node)
  const emphasis = props.emphasis(node)
  return (
    <g
      className={`graph-node graph-group ${selectedId === node.id ? 'selected' : ''}${holdsChanges ? ' pk-holds-changes' : ''}${mixedChange(node) ? ' pk-mixed-change' : ''}`}
      data-entity-id={node.id}
      {...mark(node, emphasis)}
      opacity={node.opacity}
      role="button"
      tabIndex={0}
      aria-label={label(node, entity)}
      aria-pressed={selectedId === node.id}
      onClick={() => onSelect(node.id)}
      onKeyDown={select(node.id)}
    >
      <title>{entity.id}</title>
      <rect
        className="node-surface"
        data-projections-edge=""
        x={node.x - node.width / 2}
        y={node.y - node.height / 2}
        width={node.width}
        height={node.height}
        rx="8"
        style={{fill: 'none', strokeDasharray: '4 4'}}
      />
      {emphasis > 0.01 && (
        <rect
          className={`node-emphasis ${classifyChange(node)}`}
          data-projections-edge=""
          x={node.x - node.width / 2 + inset}
          y={node.y - node.height / 2 + inset}
          width={node.width - 2 * inset}
          height={node.height - 2 * inset}
          rx={Math.max(0, 8 - inset)}
          opacity={emphasis}
        />
      )}
      <CardIcon node={node} icon={props.icon} diff={diff} x={node.x - node.width / 2 + 16} baseline={node.y - node.height / 2 + 28} />
      <text
        className="node-label pk-diff-text"
        x={node.x - node.width / 2 + 16 + (hasIcon(node, props.icon) ? cardIconRoom : 0)}
        y={node.y - node.height / 2 + 28}
      >
        {groupHeading(kindOf(entity), entity.kind, diff)}
        <tspan {...identifier}>{entity.label}</tspan>
      </text>
      {/* The boundary's bottom padding is its status footer. */}
      <SvgChangeStatus
        change={node}
        emphasis={emphasis}
        parts={statusOf(node)}
        x={node.x - node.width / 2 + 16}
        y={node.y + node.height / 2 - 8}
      />
    </g>
  )
}
