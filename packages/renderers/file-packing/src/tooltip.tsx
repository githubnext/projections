import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import type {Circle} from './transition.js'
import {listWords} from './document.js'

/** The default for an optional list prop: one array, so a default never changes between renders. */
const none: readonly never[] = []

/** Hover details: path, size and change; positioned above the circle and kept inside the area. */
export function Tooltip({
  circle,
  path,
  sizes,
  category,
  flags = none,
  view,
  area,
}: {
  circle: Circle
  path: string
  sizes: {now: string; change: string | undefined}
  category: string | undefined
  /** The leaf's flags, as the legend names them. */
  flags?: readonly string[]
  view: {x: number; y: number; scale: number}
  area: {width: number; height: number}
}) {
  const x = (circle.x - view.x) * view.scale,
    top = (circle.y - circle.r - view.y) * view.scale
  const below = top < 64
  const y = below ? (circle.y + circle.r - view.y) * view.scale + 6 : top - 6
  return (
    <div
      className="fp-tooltip"
      aria-hidden="true"
      data-placement={below ? 'below' : 'above'}
      style={{left: Math.max(90, Math.min(area.width - 90, x)), top: y}}
    >
      <span className="fp-tooltip-path" {...identifier}>
        {path}
      </span>
      <span className="fp-tooltip-size">
        {sizes.now}
        {category ? `\u00a0· ${category}` : ''}
      </span>
      {flags.length > 0 && <span className="fp-tooltip-flags">Flagged {listWords(flags)}</span>}
      {sizes.change && <span className="fp-tooltip-change">{sizes.change}</span>}
    </div>
  )
}
