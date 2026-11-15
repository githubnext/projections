// A card's change marks in a comparison: its tinted fill and change edge, and its status footer band.
import {cardTextMetrics} from '../../card-text.js'
import {SvgChangeStatus} from '../components.js'
import type {ChangeClassification, StatusPart} from '../../emphasis.js'
import {cardFooterHeight} from '../../layout.js'
import {footerBand} from './cards.js'

/** The corner radius of a graph card's shape, in card units: the footer band's bottom corners follow it. */
export const cardCornerRadius = 6

/**
 * A changed card's marks, as every kit card draws them: the card filled with its change's soft hue under a strong
 * edge of the same hue (inset by `inset`, see `emphasisInset`), and a footer band `footer` tall across its bottom,
 * ruled off from the body, holding the status words centred (see `SvgChangeStatus`). The edge is drawn again over
 * the band, so the band never covers the border or its corners. Draw it over the card's surface and under its text;
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
  const bottom = y + height
  const rule = bottom - footer
  const edge = {x: x + inset, y: y + inset, width: width - 2 * inset, height: height - 2 * inset, rx: cardCornerRadius}
  return (
    <>
      {fill && <rect className={`node-emphasis ${classification}`} data-projections-edge="" {...edge} opacity={emphasis} />}
      <path className={`node-footer-band ${classification}`} d={footerBand(x, rule, width, bottom, cardCornerRadius)} opacity={emphasis} />
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
