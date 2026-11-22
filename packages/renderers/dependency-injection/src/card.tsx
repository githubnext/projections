import {useMemo} from 'react'
import type {CSSProperties, KeyboardEvent} from 'react'
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import {
  routeBoxEdge,
  cardBorderOutset,
  routeTracks,
  spreadPorts,
  changeMark,
  classifyChange,
  describeChange,
  edgeMarkerId,
  edgePaint,
} from '@githubnext/projections-renderer-kit'
import {EdgeArrowMarker, useStageCover, useStageInsetBottom, useStageInsetTop} from '@githubnext/projections-renderer-kit/react'
import type {BoxEdge, Point, RendererLegend} from '@githubnext/projections-renderer-kit'
import {lifetimeNames} from './facets.js'
import type {DiUnit, Lifetime} from './model.js'
import type {DiLinkFrame} from './transition.js'
import {advance, rightX, textGap, textX} from './geometry.js'
import {lifetimeMark} from './lifetime-mark.js'

export {
  advance,
  halfHeight,
  halfWidth,
  headerHeight,
  kindBaseline,
  labelBaseline,
  registrationWidth,
  rightX,
  textGap,
  textX,
} from './geometry.js'

/*
 * What the transition's cards and diff mode's cards share: card geometry,
 * text fitting, descriptions, link routing and drawing, and the legend.
 */
/** Space between the frame and a fitted composition, CSS px. */
export const diPadding = 16

/**
 * The space around a fitted composition, CSS px: `diPadding`, and above it the host's `stage-inset-top` where it sends
 * one (`styles.css` pads the canvas the same), so the composition opens below what the host overlays on the frame;
 * `useCoveredPadding` then moves it down only where the fitted composition would reach the host's `stage-cover`.
 */
export function useDiPadding(): {x: number; y: number; top: number} {
  const insetTop = useStageInsetTop()
  const insetBottom = useStageInsetBottom()
  // A host that says exactly what it overlays leaves both ends to the kit's `useCoveredPadding`; one that gives only
  // bands keeps clear of them.
  const covered = Boolean(useStageCover())
  const top = covered ? diPadding : (insetTop ?? diPadding)
  const y = covered ? diPadding : Math.max(diPadding, insetBottom ?? 0)
  return useMemo(() => ({x: diPadding, y, top}), [y, top])
}

/** Units drawn at once; the host's table presents the complete model. */
export const diUnitLimit = 400

const lifetimeMeanings: Record<Lifetime, string> = {
  singleton: 'one instance for the lifetime of the application',
  scoped: 'one instance per scope',
  transient: 'a new instance every time it is injected',
  unknown: 'no container registration resolves this type',
}

/** The lifetime as a human label (`Singleton`), or the container's own scope name exactly as the data has it (`request`). */
export function lifetimeLabelOf(unit: DiUnit, lifetime: Lifetime): string {
  return unit.scope ?? lifetimeNames[lifetime]
}

export function lifetimeDescription(unit: DiUnit): string {
  const scope = unit.scope ? ` (${unit.scope})` : ''
  const declared = unit.declaredLifetime
    ? `, declared ${lifetimeNames[unit.declaredLifetime]} but re-created with the scoped services it injects`
    : ''
  return `${lifetimeNames[unit.lifetime]}${scope}: ${lifetimeMeanings[unit.lifetime]}${declared}`
}

/** The transition's cards fit text to its place; diff mode's cards show it whole (`diCardText`). */
export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Characters of `style` text that fit between the text column and a right-aligned `beside` text. */
export function room(style: keyof typeof advance, beside = '', besideStyle: keyof typeof advance = 'key'): number {
  const reserved = beside ? beside.length * advance[besideStyle] + textGap : 0
  return Math.floor((rightX - textX - reserved) / advance[style])
}

export function unitDescription(unit: DiUnit): string {
  const contract = unit.aliasOf
    ? `${unit.contract}, an alias of ${unit.aliasOf}`
    : unit.contract
      ? `${unit.contract} resolved by ${unit.implementation}`
      : `${unit.implementation}, registered as its own type`
  const keyed = unit.key ? `, keyed ${unit.key}` : ''
  const extra = unit.registrations > 1 ? `, ${unit.registrations} registrations` : ''
  const note = unit.note ? `, ${unit.note}` : ''
  return `${contract}${keyed}${extra}${note}, ${lifetimeLabelOf(unit, unit.lifetime)}`
}

export function activate(event: KeyboardEvent, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  event.stopPropagation()
  action()
}

export interface CardBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A link's route: `crossing` names the cards it crosses when no route around them exists, so it is drawn the way that
 * overlaps them least and marked (`data-projections-route="crossing"`) for the renderer checks to report.
 */
export type LinkRoute = BoxEdge & {crossing?: string[]}

/**
 * Routes every link around every card but its own two. A card with one
 * outgoing (or incoming) link below it keeps that link at its centred port.
 * When no route clears the cards, the link takes the route that overlaps them
 * least, with the cards it crosses in `crossing`.
 */
export function routeLinks(
  cards: ReadonlyMap<string, CardBox>,
  links: readonly DiLinkFrame[],
  /** How far each head's tip stays outside its target card (see the kit's `cardBorderOutset`). */
  outset = cardBorderOutset(),
): Map<string, LinkRoute> {
  // A card's arrows down to cards below leave from the middle of its bottom, as one trunk, and arrive spread evenly
  // over a band centred on the top of the card they reach, in the order they come from (see the kit's `spreadPorts`).
  const downward = (link: DiLinkFrame) => cards.get(link.toId)!.y > cards.get(link.fromId)!.y
  const arrivals = new Map<string, DiLinkFrame[]>()
  for (const link of links) if (downward(link)) arrivals.set(link.toId, [...(arrivals.get(link.toId) ?? []), link])
  const arrival = new Map<string, number>()
  for (const [id, list] of arrivals) {
    const box = cards.get(id)!
    const ordered = [...list].sort((a, b) => a.from.x - b.from.x || (a.key < b.key ? -1 : 1))
    const offsets = spreadPorts(ordered.length, box.width)
    ordered.forEach((link, index) => {
      arrival.set(link.key, link.to.x + offsets[index]!)
    })
  }
  const portsOf = (link: DiLinkFrame) =>
    downward(link) ? {start: link.from, end: {x: arrival.get(link.key)!, y: link.to.y - outset}} : ({} as {start?: Point; end?: Point})
  const route = (link: DiLinkFrame, tracks: readonly number[] = []) => {
    const from = cards.get(link.fromId)!,
      to = cards.get(link.toId)!
    const ports = portsOf(link)
    if (ports.end) ports.end = {x: ports.end.x, y: link.to.y}
    const others = [...cards].filter(([id]) => id !== link.fromId && id !== link.toId)
    const routed = routeBoxEdge(
      from,
      to,
      others.map(([, box]) => box),
      'curved',
      ports,
      outset,
      tracks,
    )
    return 'blocked' in routed ? {...routed.least, crossing: routed.crossed.map(index => others[index]![0])} : routed
  }
  // Every S the arrows turn on, then again with the runs that share a gap on separate tracks (see the kit's `routeTracks`).
  const first = links.map(link => ({link, turns: route(link).turns ?? []}))
  const turns = first.flatMap(({link, turns: linkTurns}) => linkTurns.map((turn, index) => ({...turn, key: link.key, index})))
  const tracks = new Map<string, number[]>()
  routeTracks(turns).forEach((track, index) => {
    const turn = turns[index]!
    tracks.set(turn.key, [...(tracks.get(turn.key) ?? [])])
    tracks.get(turn.key)![turn.index] = track
  })
  return new Map(links.map(link => [link.key, route(link, tracks.get(link.key) ?? [])] as const))
}

/**
 * The links' origin dots, over the links: one at each start point, which links leaving a card at the same point share,
 * then a clear copy for each link that the SDK fills in the ring's color while that link is hovered, focused or
 * selected (`data-projections-ring-with`). So the dot takes its link's state whichever link drew it last.
 */
export function LinkOrigins({
  links,
  routes,
}: {
  links: readonly Pick<DiLinkFrame, 'id' | 'key' | 'opacity'>[]
  routes: ReadonlyMap<string, {start: Point}>
}) {
  const starts = new Map<string, Point & {opacity: number}>()
  for (const link of links) {
    const start = routes.get(link.key)?.start
    if (!start) continue
    const at = `${start.x.toFixed(2)},${start.y.toFixed(2)}`
    starts.set(at, {...start, opacity: Math.max(starts.get(at)?.opacity ?? 0, link.opacity)})
  }
  return (
    <g className="di-link-origins" aria-hidden="true">
      {[...starts].map(([at, start]) => (
        <circle key={at} cx={start.x} cy={start.y} r="2.6" className="di-link-origin" opacity={start.opacity} />
      ))}
      {links.map(link => {
        const start = routes.get(link.key)?.start
        return (
          start && (
            <circle
              key={link.key}
              cx={start.x}
              cy={start.y}
              r="2.6"
              className="di-link-origin-ring"
              data-projections-edge="fill"
              data-projections-ring-with={link.id}
              opacity={link.opacity}
            />
          )
        )
      })}
    </g>
  )
}

/**
 * One link: a focusable hit path and the arrow (its origin dot is
 * `LinkOrigins`'), and its parameter while either card is selected. In diff mode it carries
 * its change (`data-change`), a removed link stays dashed and a rewired
 * link's two parts say which endpoints they show.
 */
export function LinkView({
  link,
  route,
  markerId,
  emphasis,
  labelled,
  selectedId,
  onSelect,
  diff = false,
}: {
  link: DiLinkFrame
  route: LinkRoute
  markerId: string
  emphasis: number
  labelled: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  diff?: boolean
}) {
  const {d, start, end} = route
  const paint = edgePaint(link, emphasis, 1.4)
  const arrowId = edgeMarkerId(markerId, link.key)
  const kind = link.alias ? 'alias' : link.resolution ? 'runtime resolution' : 'constructor dependency'
  const part = diff && link.key.endsWith(':before') ? ', old endpoints' : diff && link.key.endsWith(':after') ? ', new endpoints' : ''
  const dashed = (diff || emphasis > 0.01) && link.status === 'removed'
  // A link's annotation badge sits at its target end, clear of the source card's status footer.
  return (
    <g
      opacity={link.opacity}
      data-entity-id={link.id}
      data-from-id={link.fromId}
      data-to-id={link.toId}
      data-edge-key={link.key}
      data-projections-route={route.crossing ? 'crossing' : 'around'}
      {...(route.crossing ? {'data-projections-route-crosses': route.crossing.join(' ')} : {})}
      data-projections-annotation-anchor="bottom-right"
      {...(diff ? {...changeMark(link), style: {'--emphasis': emphasis} as CSSProperties} : {})}
    >
      <defs>
        <EdgeArrowMarker id={arrowId} color={paint.stroke} />
      </defs>
      <path
        d={d}
        className="di-link-hit"
        role="button"
        tabIndex={0}
        aria-label={`Inspect ${kind}${link.parameter ? ` ${link.parameter}` : ''}, ${describeChange(link)}${part}`}
        aria-pressed={selectedId === link.id}
        onClick={() => onSelect(link.id)}
        onKeyDown={event => activate(event, () => onSelect(link.id))}
      >
        <title>
          {link.alias
            ? 'alias: the same instance under another token'
            : link.resolution
              ? 'runtime service resolution'
              : `${link.parameter ? `${link.parameter}: ` : ''}constructor dependency`}
        </title>
      </path>
      <g style={paint}>
        <path
          d={d}
          data-projections-edge="line"
          className={`di-link ${link.collection ? 'collection' : ''} ${link.optional ? 'optional' : ''} ${link.resolution ? 'resolution' : ''} ${link.alias ? 'alias' : ''} ${emphasis > 0.01 ? `di-link-emphasis ${classifyChange(link)}` : ''}`}
          style={{stroke: 'inherit', strokeWidth: 'inherit'}}
          markerEnd={`url(#${arrowId})`}
          strokeDasharray={dashed ? '5 3' : undefined}
        />
      </g>
      {labelled && (!!link.parameter || link.resolution || link.alias) && (
        <text
          x={(start.x + end.x) / 2}
          y={(start.y + end.y) / 2}
          className="di-parameter"
          textAnchor="middle"
          {...(link.resolution || link.alias ? {} : identifier)}
        >
          {link.alias ? 'alias of' : link.resolution ? 'resolved at runtime' : `${link.parameter}${link.collection ? '[]' : ''}`}
        </text>
      )}
    </g>
  )
}

/**
 * The lifetime mark beside a card's kind and name lines, from `top` to `bottom` (card units from the card's centre):
 * solid for a singleton, dashed for scoped, dotted for transient (`dash`, see `lifetimeDash`). Round caps make the
 * dots round; the stroke is inset by half its width at each end, so the mark spans exactly `top` to `bottom`.
 */
export function LifetimeMark({lifetime, top, bottom, dash}: {lifetime: Lifetime; top: number; bottom: number; dash: [number, number]}) {
  const inset = lifetimeMark.stroke / 2
  return (
    <line
      className={`di-lifetime ${lifetime}`}
      aria-hidden="true"
      x1={lifetimeMark.x}
      x2={lifetimeMark.x}
      y1={top + inset}
      y2={bottom - inset}
      strokeWidth={lifetimeMark.stroke}
      strokeDasharray={`${dash[0].toFixed(2)} ${dash[1].toFixed(2)}`}
    />
  )
}

/**
 * The key the host draws once beside every pane, on one line: each lifetime's
 * swatch is its mark (solid, dashed or dotted) and its meaning is short (the
 * registration's accessible label says it in full, `lifetimeDescription`),
 * then the link styles beyond a plain constructor dependency that the
 * composition draws.
 */
export function diLegend(runtimeResolution: boolean, aliases = false): RendererLegend {
  return {
    items: [
      {label: `${lifetimeNames.singleton}: one per app`, token: 'color-fg', shape: 'line'},
      {label: `${lifetimeNames.scoped}: one per scope`, token: 'color-fg', shape: 'dashed'},
      {label: `${lifetimeNames.transient}: one per injection`, token: 'color-fg', shape: 'dotted'},
      ...(runtimeResolution ? [{label: 'Resolved at runtime', token: 'color-fg-muted' as const, shape: 'dashed' as const}] : []),
      ...(aliases ? [{label: 'Alias: the same instance', token: 'color-fg-muted' as const, shape: 'dotted' as const}] : []),
    ],
  }
}
