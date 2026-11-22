// A card's icon before its kind line (see `GraphCanvasProps.icon`), and a boundary's before its heading.
import {createElement} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import {cardIconMetrics, cardIconNode, rowIcons, type CardIconName} from '../../card-icons.js'
import type {TransitionNode} from '../../graph-transition.js'
import {keyed} from '@githubnext/projections-renderer-sdk/presentation'

/** How far a 12px line's cap height is centred above its baseline: an icon's middle sits there. */
const capMiddle = 4.2

/**
 * One icon, drawn in `currentColor` (the muted text color, `.node-icon`) with Lucide's own strokes, its glyph's left
 * edge at `x` and its middle on the cap height of the text whose baseline is `baseline`.
 */
export function CardIconGlyph({name, x, baseline, opacity = 1}: {name: CardIconName; x: number; baseline: number; opacity?: number}) {
  const {size, ink} = cardIconMetrics
  return (
    <g
      className="node-icon"
      data-card-icon={name}
      aria-hidden="true"
      transform={`translate(${x - ink} ${baseline - capMiddle - size / 2}) scale(${size / 24})`}
      opacity={opacity}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {keyed(cardIconNode(name), ([tag, attributes]) => `${tag}${JSON.stringify(attributes)}`).map(([key, [tag, attributes]]) =>
        createElement(tag, {key, ...attributes}),
      )}
    </g>
  )
}

/**
 * A card's or boundary's icon: the shown revision's, crossfading with the card's own step when it changes (one
 * revision's icon fades out as the other's fades in). The diff shows the After revision's (a removed card's Before),
 * its change listed with the card's other field changes.
 */
export function CardIcon(props: {
  node: TransitionNode
  icon: ((entity: Entity) => string | undefined) | undefined
  diff: boolean
  x: number
  baseline: number
}) {
  const {node, x, baseline} = props
  const [before, after] = rowIcons(node, props.icon)
  if (props.diff || !node.before || !node.after || before === after) {
    const shown = after ?? before
    return shown ? <CardIconGlyph name={shown} x={x} baseline={baseline} /> : null
  }
  return (
    <>
      {before && node.local < 0.999 && <CardIconGlyph key="before" name={before} x={x} baseline={baseline} opacity={1 - node.local} />}
      {after && node.local > 0.001 && <CardIconGlyph key="after" name={after} x={x} baseline={baseline} opacity={node.local} />}
    </>
  )
}
