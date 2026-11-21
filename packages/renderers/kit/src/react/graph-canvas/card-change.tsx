// A card's change marks in a comparison: its tinted fill and change edge, and its status footer band.
import {cardTextMetrics} from '../../card-text.js'
import {SvgChangeStatus} from '../components.js'
import type {ChangeClassification, StatusPart} from '../../emphasis.js'
import {cardFooterHeight} from '../../layout.js'

/**
 * The corner radius a graph card's shape is drawn with, in card units, where the theme's radius (`rx` in CSS,
 * `--projections-radius`) doesn't reach: a shape's CSS `rx` wins over it.
 */
export const cardCornerRadius = 6

/**
 * A changed card's marks, as every kit card draws them: the card filled with its change's soft hue under a strong
 * edge of the same hue (inset by `inset`, see `emphasisInset`, with its radius less the inset, so it is concentric with
 * the card's border), and a footer band `footer` tall across its bottom, ruled off from the body, holding the status
 * words centred (see `SvgChangeStatus`). The band is clipped to the card's shape (`node-card-shape`, rounded as the
 * card's surface is), so its corners follow the card's, and the edge is drawn again over it, so the band never covers
 * the border or pokes outside its corners. Draw it over the card's surface and under its text;
 * everything fades with `emphasis`, and nothing is drawn at zero. `fill: false` leaves the body's fill to the
 * caller, for a card whose parts tint their own slices of it.
 *
 * The box is in card units: `x` and `y` are its top-left corner.
 */
export function CardChangeMarks({
  change,
  classification,
  parts,
  emphasis,
  x,
  y,
  width,
  height,
  inset,
  footer = cardFooterHeight,
  fill = true,
}: {
  /** What the status words describe. */
  change: Parameters<typeof SvgChangeStatus>[0]['change']
  /** The hue the marks take: the change's own (`classifyChange`), or another a card chooses for what it shows. */
  classification: ChangeClassification
  /** The domain's own status words (see `StatusPart`); the generic ones otherwise. */
  parts?: readonly StatusPart[] | undefined
  emphasis: number
  x: number
  y: number
  width: number
  height: number
  /** How far the change edge is inset, so its outer edge is the plain border's (see `emphasisInset`). */
  inset: number
  footer?: number
  fill?: boolean
}) {
  if (emphasis <= 0.01) return null
  // Named by its geometry, not by render order (`useId`), so a frame's markup is the same however it was reached. Cards
  // of one size share it: a clip path is in the user space of what uses it, so theirs are the same shape.
  const shape = `pk-card-shape-${[x, y, width, height].map(value => String(Math.round(value * 100) / 100).replaceAll(/[^0-9-]/g, '_')).join('-')}`
  const bottom = y + height
  const rule = bottom - footer
  const edge = {x: x + inset, y: y + inset, width: width - 2 * inset, height: height - 2 * inset, rx: Math.max(0, cardCornerRadius - inset)}
  return (
    <>
      {fill && <rect className={`node-emphasis ${classification}`} data-projections-edge="" {...edge} opacity={emphasis} />}
      <clipPath id={shape}>
        <rect className="node-card-shape" x={x} y={y} width={width} height={height} rx={cardCornerRadius} />
      </clipPath>
      <rect
        className={`node-footer-band ${classification}`}
        x={x}
        y={rule}
        width={width}
        height={footer}
        clipPath={`url(#${shape})`}
        opacity={emphasis}
      />
      <line className={`node-footer-rule ${classification}`} x1={x} x2={x + width} y1={rule} y2={rule} opacity={emphasis} />
      <rect
        className={`node-emphasis node-emphasis-edge ${classification}`}
        data-projections-edge=""
        {...edge}
        opacity={emphasis}
        style={{fill: 'none'}}
      />
      <g className="node-status">
        {/* Centred in its band, at every size the card is drawn, and cut short only when wider than it. */}
        <SvgChangeStatus
          change={change}
          emphasis={emphasis}
          parts={parts}
          x={x + width / 2}
          y={bottom - 5.5}
          anchor="middle"
          room={width - 2 * cardTextMetrics.footerInset}
        />
      </g>
    </>
  )
}
