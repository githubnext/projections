// An entity's card: its surface, change border and status footer, its file icon, and its text.
import {classifyChange, mixedChange} from '../../emphasis.js'
import type {TransitionNode} from '../../graph-transition.js'
import {diffCardMetrics} from '../../diff-card/metrics.js'
import {displayed, DiffCardLines} from './cards.js'
import {CardChangeMarks} from './card-change.js'
import {CardAccentBand, CardBadges} from './facts.js'
import {CardLines, cardLinesLayout} from './card-lines.js'
import type {Drawing} from './drawing.js'
import {CardSubtitle} from './subtitle.js'
import {CardIcon} from './card-icon.js'
import {SvgIcon} from '../icons.js'

/** The expander a card that opens or closes a group draws in its top-right corner: its size and inset. */
export const expanderMetrics = {size: 14, inset: 10}

export function EntityCard({node, drawing}: {node: TransitionNode; drawing: Drawing}) {
  const {props, inset, label, mark, select, receded} = drawing
  const {selectedId, onSelect} = props
  const entity = displayed(node)
  const emphasis = props.emphasis(node)
  const {width, height} = node
  const card = props.cards?.get(node.id)
  const synthetic = props.synthetic?.(node.id) ?? false
  const action = synthetic ? (props.syntheticAction?.(entity) ?? {label: `Show ${entity.label}`}) : undefined
  const expander = action?.expanded !== undefined
  const text = cardLinesLayout(node, entity, drawing, Boolean(card), expander ? expanderMetrics.size + 4 : 0)
  const {fileNode, top, labelY, whole} = text
  const subtitle = props.subtitle?.(entity)
  // The subtitle goes under the card's last line of text: the label, or a diff card's last line.
  const textBottom = card ? top + Math.max(0, ...card.lines.map(line => line.y)) : text.labelY
  return (
    <g
      {...(synthetic ? {'data-graph-synthetic': node.id, 'data-projections-ring-item': ''} : {'data-entity-id': node.id})}
      transform={`translate(${node.x} ${node.y}) scale(${0.9 + node.opacity * 0.1})`}
      {...mark(node, emphasis)}
      opacity={node.opacity}
      className={`graph-node ${selectedId === node.id ? 'selected' : ''}${receded(node.id) ? ' receded' : ''}${mixedChange(node) ? ' pk-mixed-change' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={action ? action.label : label(node, entity)}
      aria-pressed={action ? undefined : selectedId === node.id}
      aria-expanded={action?.expanded}
      // A double click activates a card once: its second click would undo the first (closing the group it opened), and
      // selects no text.
      onMouseDown={event => {
        if (event.detail > 1) event.preventDefault()
      }}
      onClick={event => {
        if (event.detail <= 1) onSelect(node.id)
      }}
      onKeyDown={select(node.id)}
    >
      <title>{`${whole.length ? `${whole.join(' ')}\n` : ''}${subtitle ? `${subtitle}\n` : ''}${entity.id}${entity.confidence ? ` (${entity.confidence})` : ''}`}</title>
      <rect
        className="node-surface"
        data-projections-edge=""
        x={-node.width / 2}
        y={-height / 2}
        width={node.width}
        height={height}
        rx="6"
      />
      <CardChangeMarks
        change={node}
        classification={classifyChange(node)}
        parts={drawing.statusOf(node)}
        emphasis={emphasis}
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        inset={inset}
      />
      <CardAccentBand node={node} drawing={drawing} />
      {fileNode && (
        <path
          className="node-file-icon"
          aria-hidden="true"
          transform={`translate(${100 - width / 2} ${(card ? top + diffCardMetrics.firstBaseline : labelY) - 4})`}
          d="M-82.5 -7.5h6.5l3.5 3.5v11h-10z M-76 -7.5v3.5h3.5"
        />
      )}
      {card ? <DiffCardLines card={card} top={top} left={-width / 2} /> : <CardLines node={node} text={text} />}
      {!fileNode && <CardIcon node={node} icon={props.icon} diff={drawing.diff} x={text.textLeft} baseline={text.kindY} />}
      <CardSubtitle node={node} drawing={drawing} baseline={textBottom} />
      <CardBadges node={node} drawing={drawing} />
      {expander && (
        <g className="node-expander">
          <SvgIcon
            name={action.expanded ? 'collapse' : 'expand'}
            x={width / 2 - expanderMetrics.inset - expanderMetrics.size}
            y={top + expanderMetrics.inset}
            size={expanderMetrics.size}
          />
        </g>
      )}
    </g>
  )
}
