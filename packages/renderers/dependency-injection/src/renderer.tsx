import {useId, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {ReactNode} from 'react'
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import {cardBorderOutset, emphasisInset, classifyChange, contentStart, describeChange} from '@githubnext/projections-renderer-kit'
import type {ScrollStart} from '@githubnext/projections-renderer-kit'
import {
  EdgeArrowMarker,
  CardChangeMarks,
  EmptyDomain,
  cardCornerRadius,
  useBorderWidths,
  useFitScale,
  useOpeningFloor,
  useStageZoom,
  useLegend,
} from '@githubnext/projections-renderer-kit/react'
import type {RendererProps} from '@githubnext/projections-renderer-kit/react'
import {unitParts} from './model.js'
import {createDiTransition} from './transition.js'
import {diCardHeight, diMetrics, selfRegistered} from './geometry.js'
import {markSpan} from './lifetime-mark.js'
import type {DiUnitFrame} from './transition.js'
import type {DiUnit} from './model.js'
import {
  LifetimeMark,
  LinkView,
  diLegend,
  activate,
  advance,
  useDiPadding,
  diUnitLimit,
  halfWidth,
  headerHeight,
  kindBaseline,
  labelBaseline,
  lifetimeDescription,
  lifetimeLabelOf,
  registrationWidth,
  rightX,
  room,
  textGap,
  routeLinks,
  textX,
  truncate,
  unitDescription,
} from './card.js'
import {DiffView, unitStatusParts} from './diff.js'
import {unitFacets} from './facets.js'
import type {accepts} from './accepts.js'

export {diLegend, diUnitLimit} from './card.js'

export {lifetimeNames} from './facets.js'

type ZoneName = 'registration' | 'contract' | 'implementation' | 'whole'

/** The lifetime label's width in card units: a scope name is code, in the monospace font. */
const lifetimeWidth = (unit: DiUnit) => lifetimeLabelOf(unit, unit.lifetime).length * (unit.scope ? advance.key : advance.lifetime)

/**
 * The card's parts, which partition it: the kind line's row is the contract's, but for the lifetime at its right,
 * which is the registration's; the rest is the implementation's (all of it but the lifetime when the implementation
 * is registered as its own type). Each is a path, for its hit area and its tint, drawn under the text and clipped to
 * the card's rounded shape, so it never outlines or overflows the card. A tint is kept `inset` inside the card's
 * sides, within its edge, so the edge stays the card's largest shape and its ring is never covered.
 */
function zonePaths(registration: number | undefined, cardHeight: number, inset = 0): Record<ZoneName, string> {
  const top = -cardHeight / 2
  const [left, right, bottom] = [-halfWidth + inset, halfWidth - inset, top + cardHeight - inset]
  const rect = (x: number, y: number, width: number, height: number) => {
    const [x0, y0] = [Math.max(x, left), Math.max(y, top + inset)]
    const [x1, y1] = [Math.min(x + width, right), Math.min(y + height, bottom)]
    return x1 > x0 && y1 > y0 ? `M${x0} ${y0}H${x1}V${y1}H${x0}Z` : ''
  }
  const lifetime = registration ?? 0
  return {
    registration: rect(halfWidth - lifetime, top, lifetime, headerHeight),
    contract: rect(-halfWidth, top, diMetrics.width - lifetime, headerHeight),
    implementation: rect(-halfWidth, top + headerHeight, diMetrics.width, cardHeight - headerHeight),
    whole:
      rect(-halfWidth, top, diMetrics.width - lifetime, headerHeight) +
      rect(-halfWidth, top + headerHeight, diMetrics.width, cardHeight - headerHeight),
  }
}

function Zone({
  id,
  label,
  d,
  zone,
  selected,
  onSelect,
}: {
  id: string
  label: string
  d: string
  zone: ZoneName
  selected: boolean
  onSelect: () => void
}) {
  // A transparent hit area over the text; its tint is drawn underneath.
  return (
    <path
      className={`di-zone di-zone-${zone}`}
      data-entity-id={id}
      d={d}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onClick={event => {
        event.stopPropagation()
        onSelect()
      }}
      onKeyDown={event => activate(event, onSelect)}
    >
      <title>{label}</title>
    </path>
  )
}

/**
 * Text that differs between the revisions crossfades over the unit's step: the old fades out as the new fades in,
 * a name rising out as the new one rises in from below (the kit's graph cards).
 */
function Crossfade({
  values,
  local,
  rise = 0,
  render,
}: {
  values: readonly [string | undefined, string | undefined]
  local: number
  rise?: number
  render: (value: string, y: number, opacity: number | undefined) => ReactNode
}) {
  const [before, after] = values
  if (before === undefined || after === undefined || before === after || local >= 1) return render((after ?? before)!, 0, undefined)
  if (local <= 0) return render(before, 0, undefined)
  return (
    <>
      {render(before, -rise * local, 1 - local)}
      {render(after, rise * (1 - local), local)}
    </>
  )
}

function Card({
  frame,
  height,
  emphasis,
  selectedId,
  onSelect,
  clipId,
  inset,
  tintInset,
}: {
  frame: DiUnitFrame
  /** The card's height (see `diCardHeight`). */
  height: number
  /** How far the change border is inset (see `emphasisInset`), so it never reaches past the plain one toward an arrowhead. */
  inset: number
  /** How far the parts' tints are inset: to the strong edge's inner side, so the edge is the card's largest shape. */
  tintInset: number
  emphasis: number
  selectedId: string | null
  onSelect: (id: string) => void
  /** ID of this card's clip path, the card's own rounded shape. */
  clipId: string
}) {
  const unit = frame.unit
  const sides = [frame.before ?? frame.after!, frame.after ?? frame.before!] as const
  // A key or a note (a module, a bean name) beside the implementation gives way to the name: it is cut short first.
  const longest = Math.max(...sides.map(side => side.implementation.length))
  const besideName = (most: number) =>
    Math.max(6, Math.min(most, Math.floor((rightX - textX - textGap - longest * advance.implementation) / advance.key)))
  const key = unit.key ? truncate(unit.key, besideName(10)) : undefined
  const named = !key && unit.registrations <= 1 && unit.note ? truncate(unit.note, besideName(16)) : undefined
  const note = key ? `key ${key}` : unit.registrations > 1 ? `×${unit.registrations}` : (named ?? '')
  const lifetimes = sides.map(side => lifetimeLabelOf(side, side.lifetime)) as [string, string]
  const widest = lifetimes[0].length >= lifetimes[1].length ? lifetimes[0] : lifetimes[1]
  const selectedPart = (id?: string) => !!id && id === selectedId
  const touched = unitParts(unit).some(selectedPart)
  const top = -height / 2
  const registration = unit.registrationId ? registrationWidth(Math.max(...sides.map(lifetimeWidth))) : undefined
  const zones = zonePaths(registration, height)
  const tints = zonePaths(registration, height, tintInset)
  const implementationZone: ZoneName = unit.contract ? 'implementation' : 'whole'
  const selectedZone: ZoneName | undefined = selectedPart(unit.registrationId)
    ? 'registration'
    : selectedPart(unit.serviceId) && unit.contract
      ? 'contract'
      : selectedPart(unit.implementationId) || selectedPart(unit.serviceId)
        ? implementationZone
        : undefined
  const tinted: ZoneName[] = [
    ...(unit.registrationId ? ['registration' as const] : []),
    ...(unit.contract && unit.serviceId ? ['contract' as const] : []),
    implementationZone,
  ]
  const scoped = sides.some(side => side.scope)
  // A modified card says what changed about it, as its diff card does: "Lifetime changed".
  const status =
    frame.before && frame.after ? unitStatusParts({...frame, facets: unitFacets(frame.before, frame.after), dependencies: []}) : undefined
  return (
    <g
      transform={`translate(${frame.x} ${frame.y})`}
      opacity={frame.opacity}
      data-unit-id={frame.id}
      data-entity-id={frame.id}
      data-projections-unit=""
      className={`di-card ${touched ? 'selected' : ''}`}
    >
      <defs>
        <clipPath id={clipId}>
          <rect className="di-card-clip" x={-halfWidth} y={top} width={diMetrics.width} height={height} rx={cardCornerRadius} />
        </clipPath>
      </defs>
      {unit.registrations > 1 && (
        <rect className="di-card-stack" x={-halfWidth + 6} y={top + 6} width={diMetrics.width} height={height} rx={cardCornerRadius} />
      )}
      <rect
        className="di-card-surface"
        data-projections-edge=""
        x={-halfWidth}
        y={top}
        width={diMetrics.width}
        height={height}
        rx={cardCornerRadius}
      />
      {/* The kit card's change marks: its fill and edge, and its status in the footer band. */}
      <CardChangeMarks
        change={frame}
        classification={classifyChange(frame)}
        parts={status}
        emphasis={emphasis}
        x={-halfWidth}
        y={top}
        width={diMetrics.width}
        height={height}
        inset={inset}
      />
      {/* Parts are tinted, never outlined: hover and focus lightly, selection more, under the text and inside the card's shape. */}
      <g clipPath={`url(#${clipId})`} className="di-tints">
        {tinted.map(zone => (
          <path key={zone} className={`di-tint di-tint-${zone}`} d={tints[zone]} />
        ))}
        {selectedZone && <path className="di-zone-highlight" d={tints[selectedZone]} />}
      </g>

      {unit.contract ? (
        <text className="node-kind di-contract" x={textX} y={top + kindBaseline} {...identifier}>
          {truncate(unit.contract, room('contract', widest, scoped ? 'key' : 'lifetime'))}
        </text>
      ) : (
        <text className="node-kind di-self" x={textX} y={top + kindBaseline}>
          {selfRegistered}
        </text>
      )}
      <LifetimeMark lifetime={frame.lifetime} top={top + markSpan.top} bottom={top + markSpan.bottom} dash={frame.dash} />
      <Crossfade
        values={lifetimes}
        local={frame.local}
        render={(label, _, opacity) => (
          <text
            key={label}
            className={`node-detail di-lifetime-label ${frame.lifetime}`}
            x={rightX}
            y={top + kindBaseline}
            textAnchor="end"
            opacity={opacity}
            {...(sides.find(side => lifetimeLabelOf(side, side.lifetime) === label)?.scope ? identifier : {})}
          >
            {label}
          </text>
        )}
      />
      <Crossfade
        values={[sides[0].implementation, sides[1].implementation]}
        local={frame.local}
        rise={8}
        render={(name, rise, opacity) => (
          <text
            key={name}
            className="node-label di-implementation"
            x={textX}
            y={top + labelBaseline + rise}
            opacity={opacity}
            {...identifier}
          >
            {truncate(name, room('implementation', note))}
          </text>
        )}
      />
      {note && (
        <text className="node-detail di-key" x={rightX} y={top + labelBaseline} textAnchor="end">
          {key ? (
            <>
              key <tspan {...identifier}>{key}</tspan>
            </>
          ) : named ? (
            <tspan {...identifier}>{named}</tspan>
          ) : (
            note
          )}
        </text>
      )}

      {unit.contract && unit.serviceId && (
        <Zone
          label={`Inspect contract ${unit.contract}, ${describeChange(frame)}`}
          id={unit.serviceId}
          d={zones.contract}
          zone="contract"
          selected={selectedPart(unit.serviceId)}
          onSelect={() => onSelect(unit.serviceId!)}
        />
      )}
      <Zone
        label={`Inspect implementation ${unit.implementation}, ${unitDescription(unit)}, ${describeChange(frame)}`}
        id={unit.implementationId ?? unit.serviceId ?? unit.id}
        d={zones[implementationZone]}
        zone={implementationZone}
        selected={selectedPart(unit.implementationId)}
        onSelect={() => onSelect(unit.implementationId ?? unit.serviceId ?? unit.id)}
      />
      {unit.registrationId && (
        <Zone
          label={`Inspect registration of ${unit.contract ?? unit.implementation}, ${lifetimeDescription(unit)}, ${describeChange(frame)}`}
          id={unit.registrationId}
          d={zones.registration}
          zone="registration"
          selected={selectedPart(unit.registrationId)}
          onSelect={() => onSelect(unit.registrationId!)}
        />
      )}
    </g>
  )
}

/**
 * The composition: a static union of both revisions in diff mode (see
 * `DiffView`), otherwise the transition at the host's progress.
 */
export function DependencyInjectionRenderer(props: RendererProps<typeof accepts>) {
  return props.diff && props.comparing ? <DiffView {...props} /> : <TransitionView {...props} />
}

function TransitionView({
  model,
  comparing,
  schedule,
  progress,
  emphasis: emphasize,
  selectedId,
  onSelect,
  reportLegend,
  onAction,
}: RendererProps<typeof accepts>) {
  const transition = useMemo(() => createDiTransition(model, schedule, diCardHeight(comparing)), [model, schedule, comparing])
  const legend = useMemo(
    () => diLegend(transition.runtimeResolution, transition.aliases),
    [transition.runtimeResolution, transition.aliases],
  )
  useLegend(reportLegend, legend)
  const frame = transition(progress)
  const markerId = useId().replaceAll(':', '')
  // Cards never move, so each arrow is routed once, around every card either
  // revision shows: a route never changes while scrubbing and never crosses a
  // card that fades in later. Both revisions also reserve ports, so a lone
  // arrow keeps its centered attachment whichever stage is showing.
  const scroller = useRef<HTMLDivElement>(null)
  // Arrowheads stop on the outer edge of their target card's border.
  const borders = useBorderWidths(scroller)
  const outset = cardBorderOutset(borders)
  const routes = useMemo(
    () =>
      routeLinks(
        new Map(
          transition.endpoints.units.map(unit => [
            unit.id,
            {x: unit.x - halfWidth, y: unit.y - transition.height / 2, width: diMetrics.width, height: transition.height},
          ]),
        ),
        transition.endpoints.links,
        outset,
      ),
    [transition, outset],
  )
  const units = frame.units.slice(0, diUnitLimit)
  const shown = new Set(units.map(unit => unit.id))
  const links = frame.links.filter(link => shown.has(link.fromId) && shown.has(link.toId))
  const selectedUnits = new Set(frame.units.filter(unit => unitParts(unit.unit).some(part => part === selectedId)).map(unit => unit.id))

  // Framing covers both endpoints, so the composition never zooms while scrubbing.
  const bounds = useMemo(() => {
    const points = transition.endpoints.units
    if (!points.length) return {x: 0, y: 0, width: 960, height: 420}
    const xs = points.map(unit => unit.x)
    const ys = points.map(unit => unit.y)
    const x = Math.min(...xs) - halfWidth - 28
    const y = Math.min(...ys) - transition.height / 2 - 28
    return {x, y, width: Math.max(...xs) + halfWidth + 28 - x, height: Math.max(...ys) + transition.height / 2 + 28 - y}
  }, [transition])

  // Fills the frame and opens with the whole composition fitted, centred and never magnified, unless that would draw
  // its text below the kit's opening floor: then it opens at the floor, on its root, and scrolls. Zoom enlarges it,
  // keeping the middle (the spine) in view. Both endpoints share the framing and the floor.
  const floor = useOpeningFloor(scroller, transition)
  const padding = useDiPadding()
  // Zoomed in, a content-sized stage grows to the drawn scale (see `FitOptions.drawnScale`).
  const [drawnScale, setDrawnScale] = useState(0)
  const fit = useFitScale(scroller, bounds, {padding, floor, drawnScale})
  // The composition hangs from its root, centred at the top: a view that opens at the text floor opens there, on the
  // cards drawn when it is placed, with no card cut at its left edge (see `contentStart`).
  const drawn = useRef(units)
  drawn.current = units
  const start = useMemo(
    (): ScrollStart => view =>
      contentStart(
        drawn.current.map(unit => ({
          x: unit.x - halfWidth,
          y: unit.y - transition.height / 2,
          width: diMetrics.width,
          height: transition.height,
        })),
        bounds,
        padding,
        12,
        'centre',
      )(view),
    [bounds, transition, padding],
  )
  const {zoom, scale} = useStageZoom(scroller, onAction, fit.scale, {floor, start})
  useLayoutEffect(() => setDrawnScale(scale), [scale])

  return (
    <div className="di-view">
      {frame.units.length > diUnitLimit && (
        <p className="graph-notice" role="status">
          Showing {diUnitLimit} of {frame.units.length} registrations. Use the host's table for the complete model.
        </p>
      )}
      <div
        className="di-scroll pk-dot-grid"
        ref={scroller}
        data-projections-scroll="dependency-injection"
        role="region"
        aria-label="Scrollable dependency composition"
        tabIndex={0}
        data-zoom={zoom}
      >
        {!units.length ? (
          <EmptyDomain title="No registrations at this point">Move the transition to see the container.</EmptyDomain>
        ) : (
          <svg
            className="di-canvas"
            role="group"
            aria-label={`Dependency injection composition, ${units.length} registrations`}
            viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
            data-scale={scale}
            style={{width: bounds.width * scale, height: bounds.height * scale, visibility: scale ? undefined : 'hidden'}}
          >
            {units.map((unit, index) => (
              <Card
                key={unit.id}
                frame={unit}
                height={transition.height}
                selectedId={selectedId}
                onSelect={onSelect}
                clipId={`${markerId}-card-${index}`}
                inset={emphasisInset(borders)}
                tintInset={emphasisInset(borders) + borders.strong / 2}
                emphasis={emphasize(unit, transition.stepRow(unit.id))}
              />
            ))}
            {links.map(link => (
              <LinkView
                key={link.key}
                link={link}
                route={routes.get(link.key)!}
                markerId={markerId}
                emphasis={emphasize(link, transition.linkStepRow(link.key))}
                labelled={selectedUnits.has(link.fromId) || selectedUnits.has(link.toId)}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}
