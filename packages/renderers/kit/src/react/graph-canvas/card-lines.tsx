// A card's own text: its kind line with the detail at its right, then its label, each cut to fit.
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import type {Entity} from '@githubnext/projections-schemas'
import type {TransitionNode} from '../../graph-transition.js'
import {
  cardTextMetrics,
  cardTextWidth,
  cutText,
  detailText,
  entityKindLine,
  kindNote,
  kindText,
  type KindLineText,
} from '../../card-text.js'
import {cardIconRoom, hasIcon} from '../../card-icons.js'
import {KindLine} from './cards.js'
import type {Drawing} from './drawing.js'

/** How far a renamed card's old name rises out, and its new one rises in from below, as they crossfade. */
const relabelRise = 8

export interface CardLinesLayout {
  entity: Entity
  fileNode: boolean
  /** The card's top, from its centre. */
  top: number
  textLeft: number
  textRight: number
  /** Where the kind line's text starts: `textLeft`, or after the card's icon (see `GraphCanvasProps.icon`). */
  kindLeft: number
  kindY: number
  labelY: number
  labelFont: object
  /** Characters of label that fit. */
  labelRoom: number
  /** Each revision's detail, and as drawn. */
  details: (string | undefined)[]
  shownDetails: (string | undefined)[]
  kindLine: KindLineText
  kindShown: string
  note: string
  /** Text cut short on the card, for its tooltip. */
  whole: string[]
}

/**
 * Where a card's text goes: between the card's insets (a file's after its icon), above the status footer it reserves
 * in a comparison, a kind line with the detail at its right, then the label. A diff card (`card`) has its own text.
 * `reserve` is room kept free at the right of the text.
 */
export function cardLinesLayout(node: TransitionNode, entity: Entity, drawing: Drawing, card: boolean, reserve = 0): CardLinesLayout {
  const {props, kindOf} = drawing
  const {textScale} = props
  const fileNode = entity.kind === 'file'
  const {width, height} = node
  const top = -height / 2
  const textLeft = -width / 2 + (fileNode ? cardTextMetrics.fileInset : cardTextMetrics.inset)
  // `reserve` keeps room at the right of the card's top line, for an expander.
  const textRight = width / 2 - cardTextMetrics.inset - reserve
  const kindLeft = textLeft + (!fileNode && hasIcon(node, props.icon) ? cardIconRoom : 0)
  const kindY = top + cardTextMetrics.firstBaseline
  const labelY = top + (fileNode ? cardTextMetrics.firstBaseline : cardTextMetrics.labelBaseline)
  const prose = props.prose?.(entity) ?? false
  const labelFont = prose ? {} : identifier
  const details = [node.before, node.after].map(side => (side ? props.detail?.(side) : undefined))
  const shownDetails = details.map(text => (text ? detailText(text) : undefined))
  const detailWidth = Math.max(0, ...shownDetails.map(text => (text ? cardTextWidth(text, 'mono', textScale) : 0)))
  // Text longer than the card holds ends in an ellipsis, and the card's tooltip has it whole. A file has no kind line,
  // so its detail sits at the right of its path, which leaves it room.
  const besideLabel = fileNode && detailWidth ? cardTextMetrics.detailGap + detailWidth : 0
  const labelRoom = Math.floor((textRight - textLeft - besideLabel) / cardTextWidth('x', prose ? 'label' : 'mono', textScale))
  const kindLine = kindOf(entity) ?? entityKindLine(entity.kind)
  const note = kindNote(kindOf(entity), entity.confidence === 'inferred')
  const kindRoom =
    textRight -
    kindLeft -
    (detailWidth ? cardTextMetrics.detailGap + detailWidth : 0) -
    (note ? cardTextWidth(` · ${note}`, 'prose', textScale) : 0)
  const kindShown = kindText(
    kindLine.text,
    Math.max(6, Math.floor(kindRoom / cardTextWidth('x', kindLine.identifier ? 'mono' : 'prose', textScale))),
  )
  const whole = [
    !card && !fileNode && kindShown !== kindLine.text ? kindLine.text : undefined,
    !card && cutText(entity.label, labelRoom) !== entity.label ? entity.label : undefined,
  ].filter(Boolean) as string[]
  return {
    entity,
    fileNode,
    top,
    textLeft,
    textRight,
    kindLeft,
    kindY,
    labelY,
    labelFont,
    labelRoom,
    details,
    shownDetails,
    kindLine,
    kindShown,
    note,
    whole,
  }
}

export function CardLines({node, text}: {node: TransitionNode; text: CardLinesLayout}) {
  const {entity, fileNode, textLeft, kindLeft, kindY, labelY, labelFont, labelRoom, kindLine, kindShown, note} = text
  const relabeled = node.before && node.after && node.before.label !== node.after.label
  return (
    <>
      {!fileNode && <KindLine kind={kindLine} text={kindShown} note={note} x={kindLeft} y={kindY} />}
      <CardDetail node={node} text={text} />
      {relabeled ? (
        // The old name rises out as the new one rises in.
        (
          [
            ['before', node.before!],
            ['after', node.after!],
          ] as const
        ).map(([side, item], index) => (
          <text
            key={side}
            x={textLeft}
            y={labelY + (index ? relabelRise : 0) - relabelRise * node.local}
            {...labelFont}
            className={`node-label${fileNode ? ' file-path' : ''}`}
            opacity={index ? node.local : 1 - node.local}
          >
            {cutText(item.label, labelRoom)}
          </text>
        ))
      ) : (
        <text x={textLeft} y={labelY} {...labelFont} className={`node-label pk-diff-text${fileNode ? ' file-path' : ''}`}>
          {cutText(entity.label, labelRoom)}
        </text>
      )}
    </>
  )
}

/** The detail at the right of a card's kind line (a file's path line); when it differs between revisions, the two crossfade. */
function CardDetail({node, text}: {node: TransitionNode; text: CardLinesLayout}) {
  const {textRight, kindY, details, shownDetails} = text
  return details[0] !== details[1] && node.before && node.after
    ? shownDetails.map((shown, index) =>
        shown ? (
          <text
            key={index ? 'after' : 'before'}
            x={textRight}
            y={kindY}
            textAnchor="end"
            {...identifier}
            className="node-detail"
            opacity={index ? node.local : 1 - node.local}
          >
            {shown}
          </text>
        ) : null,
      )
    : (shownDetails[1] ?? shownDetails[0]) && (
        <text x={textRight} y={kindY} textAnchor="end" {...identifier} className="node-detail pk-diff-text">
          {shownDetails[1] ?? shownDetails[0]}
        </text>
      )
}
