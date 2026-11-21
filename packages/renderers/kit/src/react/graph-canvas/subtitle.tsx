// A card's subtitle: a few lines of human text under its label, such as what the entity is for.
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {TransitionNode} from '../../graph-transition.js'
import {cardTextMetrics, proseLines, subtitleMetrics} from '../../card-text.js'
import type {Drawing} from './drawing.js'

/** The width a card's subtitle may take: its text's room. */
const subtitleRoom = (cardWidth: number) => cardWidth - 2 * cardTextMetrics.inset

/** A row's subtitle lines in one revision, on a card `width` wide. */
export function subtitleOf(
  entity: Entity | undefined,
  subtitle: (entity: Entity) => string | undefined,
  width: number,
  textScale: number,
): string[] {
  const text = entity && subtitle(entity)
  return text ? proseLines(text, subtitleRoom(width), textScale) : []
}

/**
 * How much taller each card grows for its subtitle: as many lines as either revision's needs, so a card never resizes
 * while scrubbing. Rows without a subtitle grow nothing.
 */
export function subtitleGrowth(
  rows: readonly EntityChange<Entity>[],
  subtitle: (entity: Entity) => string | undefined,
  widths: ReadonlyMap<string, number>,
  textScale: number,
): Map<string, number> {
  const growth = new Map<string, number>()
  for (const row of rows) {
    const width = widths.get(row.id) ?? 0
    const lines = Math.max(...[row.before, row.after].map(side => subtitleOf(side, subtitle, width, textScale).length))
    if (lines) growth.set(row.id, lines * subtitleMetrics.line)
  }
  return growth
}

/**
 * A card's subtitle under the text above it (`baseline` is that text's last baseline, from the card's centre): the
 * shown revision's, crossfading with the card's own step when it changes. The diff shows the After revision's (a
 * removed card's Before), its change listed with the card's other field changes.
 */
export function CardSubtitle({node, drawing, baseline}: {node: TransitionNode; drawing: Drawing; baseline: number}) {
  const {props, diff} = drawing
  const growth = props.subtitleGrowth?.get(node.id)
  if (!props.subtitle || growth === undefined || growth === 0) return null
  const left = -node.width / 2 + cardTextMetrics.inset
  const lines = (entity: Entity | undefined) => subtitleOf(entity, props.subtitle!, node.width, props.textScale)
  const block = (entity: Entity | undefined, opacity: number, key: string) =>
    opacity > 0.001 ? (
      <text key={key} className="node-subtitle" opacity={opacity}>
        {lines(entity).map((line, index) => (
          <tspan key={index} x={left} y={baseline + subtitleMetrics.gap + index * subtitleMetrics.line}>
            {line}
          </tspan>
        ))}
      </text>
    ) : null
  const [before, after] = [node.before, node.after].map(side => side && props.subtitle!(side))
  if (diff || !node.before || !node.after || before === after) return block(node.after ?? node.before, 1, 'subtitle')
  return (
    <>
      {block(node.before, 1 - node.local, 'before')}
      {block(node.after, node.local, 'after')}
    </>
  )
}
