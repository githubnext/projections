// A card's facts drawn: its badges, in rows under its text, and its accent band along its leading edge.
import {useId} from 'react'
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import type {TransitionNode} from '../../graph-transition.js'
import {cardFooterHeight} from '../../layout.js'
import {cardTextMetrics} from '../../card-text.js'
import {badgeMetrics, badgeRoom, badgeText, placeBadges, unionBadges, type CardAccent, type CardBadge} from '../../graph-canvas/badges.js'
import type {Drawing} from './drawing.js'
import {SvgIcon} from '../icons.js'

/** A pill path with fully rounded ends. */
function pill(x: number, y: number, width: number): string {
  const r = badgeMetrics.height / 2
  return `M${x + r} ${y}H${x + width - r}A${r} ${r} 0 0 1 ${x + width - r} ${y + badgeMetrics.height}H${x + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
}

/**
 * A card's badges in rows at the bottom of its text, above its status footer. In the diff, both revisions' badges are
 * drawn, those the change added or removed marked as such; otherwise the shown revision's, crossfading with the card's
 * own step when they differ.
 */
export function CardBadges({node, drawing}: {node: TransitionNode; drawing: Drawing}) {
  const {props, diff} = drawing
  const grow = props.badgeGrowth?.get(node.id)
  if (grow === undefined || grow === 0 || !props.badges) return null
  const [before, after] = [node.before, node.after].map(side => (side ? (props.badges!(side) ?? []) : []))
  const top = node.height / 2 - (props.comparing ? cardFooterHeight : 0) - grow - badgeMetrics.gap
  const left = -node.width / 2 + cardTextMetrics.inset
  const room = badgeRoom(node.width)
  const group = (values: readonly CardBadge[], tone: (value: CardBadge) => string | undefined, opacity = 1, key = 'badges') => (
    <g key={key} className="node-badges" opacity={opacity}>
      {placeBadges(values, room, props.textScale).map((badge, index) => {
        const y = top + badge.row * badgeMetrics.row
        const change = tone(values[index]!)
        const x = left + badge.x
        const icon = badge.tone === 'highlight' ? badgeMetrics.icon + badgeMetrics.iconGap : 0
        const inset = badge.tone === 'quiet' ? 0 : badgeMetrics.inset
        return (
          <g key={index} className={`node-badge${badge.tone ? ` ${badge.tone}` : ''}${change ? ` ${change}` : ''}`}>
            {badge.tone !== 'quiet' && <path className="node-badge-surface" d={pill(x, y, badge.width)} />}
            {icon > 0 && (
              <SvgIcon
                name="enforced"
                className="node-badge-icon"
                x={x + badgeMetrics.inset}
                y={y + (badgeMetrics.height - badgeMetrics.icon) / 2}
                size={badgeMetrics.icon}
              />
            )}
            {/* Words are centred: their pill is sized to the sans advance, which most text is narrower than. */}
            <text
              className="node-badge-text pk-diff-text"
              x={badge.prose ? x + inset + icon + (badge.width - 2 * inset - icon) / 2 : x + inset}
              y={y + badgeMetrics.height / 2 + 4}
              {...(badge.prose ? {textAnchor: 'middle'} : identifier)}
            >
              {badge.text}
            </text>
          </g>
        )
      })}
    </g>
  )
  if (diff) {
    const was = new Set(before!.map(badgeText)),
      now = new Set(after!.map(badgeText))
    // Only a modified card marks its badges: an added or removed card's change is the whole card.
    const marked = Boolean(node.before && node.after)
    return group(unionBadges(before!, after!), value =>
      marked && !was.has(badgeText(value)) ? 'added' : marked && !now.has(badgeText(value)) ? 'removed' : undefined,
    )
  }
  const same = before!.length === after!.length && before!.every((value, index) => badgeText(value) === badgeText(after![index]!))
  if (same || !node.before || !node.after) return group(node.after ? after! : before!, () => undefined)
  // Mid-step both revisions' badges show, crossfading; settled, only the shown one is drawn.
  return (
    <>
      {node.local < 1 && group(before!, () => undefined, 1 - node.local, 'before')}
      {node.local > 0 && group(after!, () => undefined, node.local, 'after')}
    </>
  )
}

/**
 * A card's accent band: the shown revision's, crossfading with the card's own step when it changes. It is cut to the
 * card's own corners (`clipPath`s of the card's shape, their radii the theme's), so it follows them. Its rim covers the
 * outer half of the card's border along it, so the band replaces the border there rather than drawing beside it; the
 * rim gives way while the card is ringed, so the ring shows round the whole card. Both stay as narrow as the band, so
 * the band never encloses what the card holds.
 */
export function CardAccentBand({node, drawing}: {node: TransitionNode; drawing: Drawing}) {
  const {props, diff, stroke} = drawing
  const id = useId().replace(/[^\w-]/gu, '')
  if (!props.accent) return null
  const [before, after] = [node.before, node.after].map(side => (side ? props.accent!(side) : undefined))
  const [left, top, half] = [-node.width / 2, -node.height / 2, stroke / 2]
  const band = (accent: CardAccent | undefined, opacity: number, key: string) =>
    accent && opacity > 0.001 ? (
      <g key={key} opacity={opacity} {...(accent.category === undefined ? {} : {'data-projections-category': accent.category})}>
        <rect
          className="node-accent-rim"
          x={left - half}
          y={top - half}
          width={badgeMetrics.accent + half}
          height={node.height + stroke}
          clipPath={`url(#${id}-outer)`}
          style={{fill: accent.paint}}
        />
        <rect
          className="node-accent"
          x={left}
          y={top}
          width={badgeMetrics.accent}
          height={node.height}
          clipPath={`url(#${id}-inner)`}
          style={{fill: accent.paint}}
        />
      </g>
    ) : null
  const shapes = (
    <defs>
      <clipPath id={`${id}-outer`}>
        <rect className="node-accent-outer" x={left - half} y={top - half} width={node.width + stroke} height={node.height + stroke} />
      </clipPath>
      <clipPath id={`${id}-inner`}>
        <rect className="node-accent-inner" x={left} y={top} width={node.width} height={node.height} />
      </clipPath>
    </defs>
  )
  if (diff || !node.before || !node.after || before?.paint === after?.paint) {
    return (
      <>
        {shapes}
        {band(after ?? before, 1, 'accent')}
      </>
    )
  }
  return (
    <>
      {shapes}
      {band(before, 1 - node.local, 'before')}
      {band(after, node.local, 'after')}
    </>
  )
}
