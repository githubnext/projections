// Parts of a drawn card: its kind line, boundary heading, status footer and diff lines.
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import type {Entity} from '@githubnext/projections-schemas'
import type {TransitionNode} from '../../graph-transition.js'
import {entityKindLine, kindText} from '../../card-text.js'
import type {KindLineText} from '../../card-text.js'
import type {DiffCardText} from '../../diff-card/metrics.js'

export function displayed(node: TransitionNode): Entity {
  return node.local < 0.5 ? (node.before ?? node.after!) : (node.after ?? node.before!)
}

/** A card's kind line: the renderer's (a resource type, say) or the entity kind, as it fits, then its note. */
export function KindLine(props: {kind: KindLineText; text: string; note: string; x: number; y: number}) {
  return (
    <text x={props.x} y={props.y} className="node-kind">
      <tspan {...(props.kind.identifier ? identifier : {})}>{props.text}</tspan>
      {props.note ? ` · ${props.note}` : ''}
    </text>
  )
}

/** A boundary's heading prefix: `module: ` by default, or the renderer's kind line. */
export function groupHeading(given: KindLineText | undefined, fallback: string, whole = false) {
  const fromEntity = entityKindLine(fallback)
  if (!given && !fromEntity.identifier) return `${fromEntity.text}: `
  const kind = given ?? fromEntity
  return (
    <>
      <tspan className="node-kind" {...(kind.identifier ? identifier : {})}>
        {whole ? kind.text : kindText(kind.text)}
      </tspan>{' '}
    </>
  )
}

/** A card's status footer band: its full width from `top` to the card's `bottom`, rounded on the bottom corners like the card. */
export function footerBand(x: number, top: number, width: number, bottom: number, radius: number): string {
  const r = Math.min(radius, bottom - top, width / 2)
  return `M${x} ${top}H${x + width}V${bottom - r}A${r} ${r} 0 0 1 ${x + width - r} ${bottom}H${x + r}A${r} ${r} 0 0 1 ${x} ${bottom - r}Z`
}

/** A diff card's text, laid out whole by `diffCardText`: each line in its own style, values struck or added. */
export function DiffCardLines({card, top, left}: {card: DiffCardText; top: number; left: number}) {
  const tones = {was: 'pk-svg-was', now: 'pk-svg-now', arrow: 'pk-svg-arrow', note: 'node-note'} as const
  return (
    <g className="node-text">
      {card.lines.map((line, index) => (
        <text
          key={index}
          x={left + line.x}
          y={top + line.y}
          className={`${line.className} pk-diff-text`}
          {...(line.anchor ? {textAnchor: line.anchor} : {})}
          {...(line.identifier ? identifier : {})}
        >
          {line.spans.map((span, at) =>
            span.tone ? (
              <tspan key={at} className={tones[span.tone]}>
                {span.text}
              </tspan>
            ) : (
              <tspan key={at}>{span.text}</tspan>
            ),
          )}
        </text>
      ))}
    </g>
  )
}
