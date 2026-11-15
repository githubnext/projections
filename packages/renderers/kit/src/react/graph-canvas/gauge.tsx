// A card's weight gauge: a bar along its top edge as long as its share of the heaviest weight.
import type {TransitionNode} from '../../graph-transition.js'
import type {Drawing} from './drawing.js'

/** How thick a card's weight gauge is (see `CardWeightGauge`). */
export const gaugeThickness = 3

/**
 * A card's weight gauge: a bar along its top edge from its leading corner, as long as its share of the heaviest
 * weight of the card's width (see `weightShares`), in its accent's paint when it has one, so with the accent band it
 * draws one corner. A weight that changes grows or shrinks through the card's own step; the diff shows the After
 * revision's (a removed card's Before).
 */
export function CardWeightGauge({node, drawing}: {node: TransitionNode; drawing: Drawing}) {
  const {props, diff} = drawing
  const share = props.weightShares?.get(node.id)
  if (!share) return null
  const local = diff ? 1 : node.local
  const fraction =
    share.before === undefined || !node.before
      ? (share.after ?? 0)
      : share.after === undefined || !node.after
        ? share.before
        : share.before + (share.after - share.before) * local
  const r = 6
  const x = -node.width / 2 + r,
    y = -node.height / 2
  const length = Math.max(0, fraction * (node.width - 2 * r))
  if (length < 0.5) return null
  const entity = (node.after ?? node.before)!
  const accent = props.accent?.(diff || local >= 0.5 ? (node.after ?? node.before)! : (node.before ?? node.after)!)
  return (
    <path
      className="node-gauge"
      aria-hidden="true"
      d={`M${x} ${y}h${length}v${gaugeThickness}h${-length}Z`}
      style={accent ? {fill: accent.paint} : {}}
      {...(accent?.category === undefined ? {} : {'data-projections-category': accent.category})}
      data-weight={props.weight?.(entity)}
    />
  )
}
