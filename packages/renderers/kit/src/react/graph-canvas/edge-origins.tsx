// Where each relationship leaves its source: one dot per start point, which the edges leaving there share.
import type {Point} from '../../edge-arrows.js'

/** The radius of an edge's origin dot, in the drawing's units. */
export const edgeOriginRadius = 2.6

/** An edge as its origin dot needs it. */
export interface EdgeOrigin {
  /** Its stable key. */
  key: string
  /** The entity it rings with (`data-projections-ring-with`), unless it is synthetic. */
  id?: string | undefined
  /** Where its line starts, on its source's edge. */
  start: Point
  /** Its presence now, which its dot fades with. */
  opacity: number
  /** Its line's color as drawn now: a change's hue while it is emphasized. */
  stroke: string
  /** Hovered or focused while synthetic, which the SDK doesn't ring: drawn in the hover color. */
  hot?: boolean
}

/**
 * The edges' origin dots, over the cards like their arrowheads: one at each start point, in its edges' color when they
 * agree (a change's hue only when every edge leaving there has it, so a hue never stands for edges it doesn't), else
 * the neutral edge color. Then a clear copy for each edge, which the SDK fills in the ring's color while that edge is
 * hovered, focused or selected (`data-projections-ring-with`), so the dot takes its edge's state whichever edge
 * shares it.
 */
export function EdgeOrigins({edges}: {edges: readonly EdgeOrigin[]}) {
  const starts = new Map<string, Point & {opacity: number; strokes: Set<string>}>()
  for (const edge of edges) {
    const at = `${edge.start.x.toFixed(2)},${edge.start.y.toFixed(2)}`
    const seen = starts.get(at)
    starts.set(at, {
      ...edge.start,
      opacity: Math.max(seen?.opacity ?? 0, edge.opacity),
      strokes: new Set([...(seen?.strokes ?? []), edge.stroke]),
    })
  }
  return (
    <g className="graph-edge-origins" aria-hidden="true">
      {[...starts].map(([at, start]) => (
        <circle
          key={at}
          cx={start.x}
          cy={start.y}
          r={edgeOriginRadius}
          className="graph-edge-origin"
          data-at={at}
          opacity={start.opacity}
          style={start.strokes.size === 1 ? {fill: [...start.strokes][0]} : undefined}
        />
      ))}
      {edges.map(edge => (
        <circle
          key={edge.key}
          cx={edge.start.x}
          cy={edge.start.y}
          r={edgeOriginRadius}
          className={`graph-edge-origin-ring${edge.hot ? ' hot' : ''}`}
          data-origin-of={edge.key}
          {...(edge.id === undefined ? {} : {'data-projections-edge': 'fill', 'data-projections-ring-with': edge.id})}
          opacity={edge.opacity}
        />
      ))}
    </g>
  )
}
