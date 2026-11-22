import {useId, useMemo, useRef, useState, type CSSProperties} from 'react'
import {
  cardBorderOutset,
  changeMark,
  classifyChange,
  describeChange,
  emphasisInset,
  cardTextMetrics,
  statusIcons,
  statusParts,
  svgStatusWidth,
  contentStart,
  textPill,
  type ChangeClassification,
  type StatusPart,
} from '@githubnext/projections-renderer-kit'
import {
  CardChangeMarks,
  cardCornerRadius,
  useBorderWidths,
  useCoveredPadding,
  useScrolledPadding,
  useFitScale,
  useLegend,
  useOpeningFloor,
  useStageZoom,
  type RendererProps,
} from '@githubnext/projections-renderer-kit/react'
import type {accepts} from './accepts.js'
import {unitParts} from './model.js'
import {capitalize, createDiDiff, type DiDependencyChange, type DiDiff, type DiDiffUnit} from './diff-model.js'
import {diMetrics, monoAdvance, sansAdvance} from './geometry.js'
import {lifetimeDash, markSpan} from './lifetime-mark.js'
import {facetNouns, type DiFacetChange} from './facets.js'
import {
  LifetimeMark,
  LinkOrigins,
  LinkView,
  activate,
  diLegend,
  useDiPadding,
  diUnitLimit,
  halfHeight,
  halfWidth,
  lifetimeDescription,
  rightX,
  routeLinks,
  unitDescription,
} from './card.js'
import {DependencyLine, DiLine} from './diff-lines.js'
import {LifetimePill, useTextAdvances} from './lifetime-pill.js'
import {keyed} from '@githubnext/projections-renderer-sdk/presentation'

const linkNouns: Record<DiDependencyChange['kind'], [string, string]> = {
  dependency: ['dependency', 'dependencies'],
  'runtime resolution': ['runtime resolution', 'runtime resolutions'],
  alias: ['alias', 'aliases'],
}

/** The facets a card names as changed, in words: "Lifetime changed", "Lifetime and implementation changed". */
export function facetWords(facets: readonly DiFacetChange[], dependencies = false): string | undefined {
  if (!facets.length) return undefined
  const nouns = [...facets.map(facet => facetNouns[facet.facet][0]), ...(dependencies ? ['dependencies'] : [])]
  const listed = nouns.length === 1 ? nouns[0]! : `${nouns.slice(0, -1).join(', ')} and ${nouns.at(-1)}`
  return `${capitalize(listed)} changed`
}

/** The links a card gained or lost, in words: "Dependency added", "Runtime resolutions removed", "Dependencies changed". */
export function dependencyWords(dependencies: readonly DiDependencyChange[]): string {
  const kinds = new Set(dependencies.map(item => item.kind))
  const [singular, plural] = linkNouns[kinds.size === 1 ? [...kinds][0]! : 'dependency']
  const changes = new Set(dependencies.map(item => item.change))
  const change = changes.size === 1 ? [...changes][0]! : 'changed'
  return capitalize(`${dependencies.length > 1 || change === 'changed' ? plural : singular} ${change}`)
}

/** A facet change for assistive technology: "lifetime changed, was Scoped, now Singleton". */
const facetSpeech = (facet: DiFacetChange) => `${facetNouns[facet.facet][0]} changed, was ${facet.before}, now ${facet.after}`
const dependencySpeech = (dependency: DiDependencyChange) => `${dependency.kind} ${dependency.change}: ${dependency.name}`

/**
 * The status words in a card's footer: what changed about it, or the comparison's own word when that is more than
 * its footer band holds (the card shows each change in place). A card that only gained or lost links says which.
 */
export function unitStatusParts(unit: Pick<DiDiffUnit, 'status' | 'renamed' | 'facets' | 'dependencies'>): StatusPart[] {
  const generic = statusParts(unit)
  const modified = (label: string): StatusPart => ({status: 'modified', glyph: '~', icon: statusIcons.modified, label})
  if (unit.status === 'unchanged' && !unit.renamed) {
    return unit.dependencies.length ? [modified(dependencyWords(unit.dependencies))] : generic
  }
  const words = facetWords(unit.facets, unit.dependencies.length > 0)
  if (!words || unit.status !== 'modified') return generic
  const parts = unit.renamed ? [...generic.filter(part => part.status === 'renamed'), modified(words)] : [modified(words)]
  return svgStatusWidth(parts, unit) <= diMetrics.width - 2 * cardTextMetrics.footerInset ? parts : generic
}

/** The hue a diff card takes: its change's, or the modified hue for a card whose only change is the links it gained or lost. */
export function unitTone(unit: Pick<DiDiffUnit, 'status' | 'renamed' | 'dependencies'>): ChangeClassification | undefined {
  const classification = classifyChange(unit)
  return classification !== 'unchanged' ? classification : unit.dependencies.length ? 'modified' : undefined
}

type PartName = 'registration' | 'contract' | 'implementation' | 'whole'

/**
 * A diff card's parts partition its shape, so each is tinted with its own change: the registration is the lifetime
 * (at the kind line's right, or the lines it takes under it), the contract the rest of the kind line's rows and the
 * implementation everything below (and the contract's rows too, when it is registered as its own type).
 */
function partPaths(card: DiDiffUnit, registered: boolean, inset = 0): Record<PartName, string> {
  const {registration, split} = card.text
  const top = -halfHeight
  // Each part's box, kept `inset` inside the card's sides.
  const [left, right, bottom] = [-halfWidth + inset, halfWidth - inset, top + card.height - inset]
  const rect = (x: number, y: number, width: number, height: number) => {
    const [x0, y0] = [Math.max(x, left), Math.max(y, top + inset)]
    const [x1, y1] = [Math.min(x + width, right), Math.min(y + height, bottom)]
    return x1 > x0 && y1 > y0 ? `M${x0} ${y0}H${x1}V${y1}H${x0}Z` : ''
  }
  const besides = registered && registration.y === 0
  const contract = registered
    ? besides
      ? rect(-halfWidth, top, diMetrics.width - registration.width, split)
      : rect(-halfWidth, top, diMetrics.width, registration.y)
    : rect(-halfWidth, top, diMetrics.width, split)
  const implementation = rect(-halfWidth, top + split, diMetrics.width, card.height - split)
  return {
    registration: rect(registration.x - halfWidth, top + registration.y, registration.width, registration.height),
    contract,
    implementation,
    whole: contract + implementation,
  }
}

/**
 * One selectable part: the entity element, a button tinted with its own
 * change under the card's text, clipped to the card's shape. Hover, focus
 * and selection tint it too, never outline it.
 */
function Part({
  id,
  part,
  d,
  label,
  clipId,
  change,
  emphasis,
  selected,
  onSelect,
  pill,
}: {
  id: string
  part: PartName
  d: string
  /** The lifetime's pill: the part's change fills `d`, its hover, focus and selection tint the pill instead. */
  pill?: ReturnType<typeof textPill> | undefined
  label: string
  clipId: string
  change: ReturnType<typeof changeMark>
  emphasis: number
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <g
      className={`di-zone di-zone-${part} di-part`}
      data-entity-id={id}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      {...change}
      style={{'--emphasis': emphasis} as CSSProperties}
      onClick={event => {
        event.stopPropagation()
        onSelect(id)
      }}
      onKeyDown={event => activate(event, () => onSelect(id))}
    >
      <title>{label}</title>
      <path className="di-part-change" clipPath={`url(#${clipId})`} d={d} />
      {pill ? (
        <LifetimePill box={pill} tint={`di-tint-${part}`} selected={selected} />
      ) : (
        <>
          <path className={`di-tint di-tint-${part}`} clipPath={`url(#${clipId})`} d={d} />
          {selected && <path className="di-zone-highlight" clipPath={`url(#${clipId})`} d={d} />}
        </>
      )}
    </g>
  )
}

/**
 * A diff card: the kit graph card's look (see the kit's `CardChangeMarks`), filled with its change's hue under a
 * strong edge, its status in a band across its bottom. The fill is drawn in slices, one per part: a part that changed
 * tints its own (so it says which entity changed), and the card tints the rest.
 */
function DiffCard({
  unit: card,
  diff,
  emphasis,
  selectedId,
  onSelect,
  clipId,
  inset,
  fillInset,
}: {
  unit: DiDiffUnit
  diff: DiDiff
  /** How far a change edge (drawn at the strong width) is inset, so its outer edge is the plain border's (see `emphasisInset`). */
  inset: number
  /** How far the fill is inset: to the change edge's inner side, so the edge is the card's largest shape. */
  fillInset: number
  emphasis: (change: Parameters<RendererProps['emphasis']>[0], id?: string) => number
  selectedId: string | null
  onSelect: (id: string) => void
  clipId: string
}) {
  const unit = card.unit
  const height = card.height
  const top = -halfHeight
  const tone = unitTone(card)
  const linkEmphasis = (id: string) => emphasis({status: card.dependencies.find(item => item.id === id)?.change ?? 'unchanged'}, id)
  // A card whose only change is its links is as strong as they are.
  const strength =
    classifyChange(card) !== 'unchanged' ? emphasis(card, card.id) : Math.max(0, ...card.dependencies.map(item => linkEmphasis(item.id)))
  const selectedPart = (id?: string) => !!id && id === selectedId
  const implementationPart: PartName = unit.contract ? 'implementation' : 'whole'
  const rowOf = (id: string | undefined) => (id === undefined ? undefined : diff.row(id))
  const partMark = (id: string | undefined) => {
    const row = rowOf(id)
    return row ? changeMark(row) : {}
  }
  const partEmphasis = (id: string | undefined) => {
    const row = rowOf(id)
    return row ? emphasis(row, row.id) : 0
  }
  const facetsBy = (...names: DiFacetChange['facet'][]) => card.facets.filter(facet => names.includes(facet.facet))
  const speech = (facets: readonly DiFacetChange[], dependencies: readonly DiDependencyChange[] = []) =>
    [describeChange(card), ...facets.map(facetSpeech), ...dependencies.map(dependencySpeech)].join(', ')
  const implementationId = unit.implementationId ?? unit.serviceId ?? unit.id
  const parts: {part: PartName; id: string | undefined; changeId: string | undefined}[] = [
    ...(unit.registrationId ? [{part: 'registration' as const, id: unit.registrationId, changeId: unit.registrationId}] : []),
    ...(unit.contract ? [{part: 'contract' as const, id: unit.serviceId, changeId: unit.serviceId}] : []),
    {part: implementationPart, id: implementationId, changeId: unit.implementationId ?? unit.serviceId},
  ]
  // The fill's slices and the parts' tints, inside the change edge: the card's marked edges stay its largest shapes,
  // topmost, so its hover, focus and selection ring is never covered.
  // A card that shows its changed values or links is drawn neutral: they carry the change colors (no nesting).
  const holdsChanges =
    card.text.dependencies.length > 0 || card.text.lines.some(line => line.spans.some(span => span.tone === 'was' || span.tone === 'now'))
  const slices = tone && !holdsChanges ? parts.filter(item => !(item.id && partMark(item.changeId)['data-change'])) : []
  const slicePaths = partPaths(card, !!unit.registrationId, fillInset)
  // A lifetime at the kind line's right is a pill as wide as the browser draws it, neutral over its part's slice.
  const lifetime = card.text.lines.find(line => line.role === 'lifetime')
  const lifetimeText = lifetime?.spans.map(span => span.text).join('') ?? ''
  const text = useRef<SVGGElement>(null)
  const advanceOf = useTextAdvances(text, '.di-lifetime-label', lifetimeText, () =>
    (lifetime?.spans ?? []).reduce((sum, span) => sum + span.text.length * (span.code ? monoAdvance : sansAdvance), 0),
  )
  const pill = lifetime && card.text.registration.y === 0 ? textPill(rightX, top + lifetime.y, advanceOf(lifetimeText), 'end') : undefined
  return (
    <g
      transform={`translate(${card.x} ${card.y})`}
      data-unit-id={card.id}
      data-entity-id={card.id}
      data-projections-unit=""
      className={`di-card di-diff-card ${unitParts(unit).some(selectedPart) ? 'selected' : ''}${holdsChanges ? ' pk-holds-changes' : ''}`}
      {...changeMark(card)}
      style={{'--emphasis': strength} as CSSProperties}
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
      {tone && (
        <g className="di-card-fill" data-change={tone}>
          {/* One path, so slices that meet leave no antialiased seam between them. */}
          {slices.length > 0 && (
            <path className="di-slice" clipPath={`url(#${clipId})`} d={slices.map(item => slicePaths[item.part]).join('')} />
          )}
        </g>
      )}

      {unit.registrationId && (
        <Part
          id={unit.registrationId}
          part="registration"
          d={slicePaths.registration}
          clipId={clipId}
          label={`Inspect registration of ${unit.contract ?? unit.implementation}, ${lifetimeDescription(unit)}, ${speech(facetsBy('lifetime', 'registrations'))}`}
          change={partMark(unit.registrationId)}
          emphasis={partEmphasis(unit.registrationId)}
          selected={selectedPart(unit.registrationId)}
          onSelect={onSelect}
          pill={pill}
        />
      )}
      {unit.contract && unit.serviceId && (
        <Part
          id={unit.serviceId}
          part="contract"
          d={slicePaths.contract}
          clipId={clipId}
          label={`Inspect contract ${unit.contract}, ${speech(facetsBy('service'))}`}
          change={partMark(unit.serviceId)}
          emphasis={partEmphasis(unit.serviceId)}
          selected={selectedPart(unit.serviceId)}
          onSelect={onSelect}
        />
      )}
      <Part
        id={implementationId}
        part={implementationPart}
        d={slicePaths[implementationPart]}
        clipId={clipId}
        label={`Inspect implementation ${unit.implementation}, ${unitDescription(unit)}, ${speech(
          unit.contract ? facetsBy('implementation') : facetsBy('implementation', 'service'),
          card.dependencies,
        )}`}
        change={partMark(unit.implementationId ?? unit.serviceId)}
        emphasis={partEmphasis(unit.implementationId ?? unit.serviceId)}
        selected={selectedPart(unit.implementationId) || (!unit.contract && selectedPart(unit.serviceId))}
        onSelect={onSelect}
      />

      {tone && (
        <CardChangeMarks
          change={classifyChange(card) === 'unchanged' ? {status: 'modified'} : card}
          classification={tone}
          parts={unitStatusParts(card)}
          emphasis={strength}
          x={-halfWidth}
          y={top}
          width={diMetrics.width}
          height={height}
          inset={inset}
          fill={false}
        />
      )}
      <LifetimeMark
        lifetime={unit.lifetime}
        top={top + markSpan.top}
        bottom={top + card.text.markBottom}
        dash={lifetimeDash(unit.lifetime, card.text.markBottom - markSpan.top)}
      />
      {!unit.registrationId && pill && <LifetimePill box={pill} selected={false} />}
      <g className="di-card-text" aria-hidden="true" ref={text}>
        {keyed(card.text.lines, line => `${line.role}:${line.spans.map(span => span.text).join('')}`).map(([key, line]) => (
          <DiLine key={key} line={line} top={top} lifetime={line.role === 'lifetime' ? unit.lifetime : undefined} />
        ))}
        {keyed(card.text.dependencies, line => line.pieces.map(piece => piece.text).join('')).map(([key, line]) => (
          <DependencyLine key={key} dependencies={card.dependencies} pieces={line.pieces} y={top + line.y} emphasis={linkEmphasis} />
        ))}
      </g>
    </g>
  )
}

/**
 * Diff mode: both revisions at once in the composition's own form, laid out
 * once (`createDiDiff`); the host's summary bar counts what changed. Added cards are
 * green, removed ones red, dashed and struck through, and a modified card
 * tints the parts that changed and lists what changed (old value struck
 * through, then the new one) above its status words. Links a card gained
 * or lost are listed on it, and drawn green, or red and dashed; a rewired
 * link shows both.
 */
export function DiffView({model, emphasis, selectedId, onSelect, reportLegend, onAction}: RendererProps<typeof accepts>) {
  const diff = useMemo(() => createDiDiff(model), [model])
  const legend = useMemo(() => diLegend(diff.runtimeResolution, diff.aliases), [diff.runtimeResolution, diff.aliases])
  useLegend(reportLegend, legend)
  const markerId = useId().replaceAll(':', '')
  const boxes = useMemo(
    () =>
      new Map(
        diff.units.map(unit => [unit.id, {x: unit.x - halfWidth, y: unit.y - halfHeight, width: diMetrics.width, height: unit.height}]),
      ),
    [diff],
  )
  const scroller = useRef<HTMLDivElement>(null)
  // Arrowheads stop on the outer edge of their target card's border; change edges are inset to the same edge.
  const borders = useBorderWidths(scroller)
  const outset = cardBorderOutset(borders)
  const routes = useMemo(() => routeLinks(boxes, diff.links, outset), [boxes, diff, outset])
  const units = diff.units.slice(0, diUnitLimit)
  const shown = new Set(units.map(unit => unit.id))
  const links = diff.links.filter(link => shown.has(link.fromId) && shown.has(link.toId))
  const selectedUnits = new Set(units.filter(unit => selectedId !== null && unitParts(unit.unit).includes(selectedId)).map(unit => unit.id))
  const bounds = useMemo(() => {
    const all = [...boxes.values()]
    if (!all.length) return {x: 0, y: 0, width: 960, height: 420}
    const x = Math.min(...all.map(box => box.x)) - 28
    const y = Math.min(...all.map(box => box.y)) - 28
    return {
      x,
      y,
      width: Math.max(...all.map(box => box.x + box.width)) + 28 - x,
      height: Math.max(...all.map(box => box.y + box.height)) + 28 - y,
    }
  }, [boxes])
  // Opens fitted, everything in view, unless that would draw its text below the kit's opening floor: then it opens at
  // the floor on its top row's leftmost card (from the layout alone, never the frame's momentary size) and scrolls.
  const floor = useOpeningFloor(scroller, diff)
  const padding = useCoveredPadding(scroller, bounds, useDiPadding())
  // Zoomed in, a content-sized stage grows to the drawn scale (see `FitOptions.drawnScale`).
  const [drawnScale, setDrawnScale] = useState(0)
  const fit = useFitScale(scroller, bounds, {padding, floor, drawnScale})
  // The padding as drawn (more under a cover once it scrolls): the opening view is placed in it.
  const drawnPadding = useScrolledPadding(padding, drawnScale, fit.scale, {content: bounds.height, view: fit.height})
  const start = useMemo(() => contentStart([...boxes.values()].slice(0, diUnitLimit), bounds, drawnPadding), [boxes, bounds, drawnPadding])
  const {zoom, scale} = useStageZoom(scroller, onAction, fit.scale, {floor, start})
  if (drawnScale !== scale) setDrawnScale(scale)

  return (
    <div className="di-view" data-diff="">
      {diff.units.length > diUnitLimit && (
        <p className="graph-notice" role="status">
          Showing {diUnitLimit} of {diff.units.length} registrations. Use the host's table for the complete model.
        </p>
      )}
      <div
        className="di-scroll pk-dot-grid"
        ref={scroller}
        style={{'--pk-fit-top': `${drawnPadding.top}px`, '--pk-fit-bottom': `${drawnPadding.y}px`} as CSSProperties}
        data-projections-scroll="dependency-injection"
        role="region"
        aria-label="Scrollable dependency composition"
        tabIndex={0}
        data-zoom={zoom}
      >
        <svg
          className="di-canvas"
          role="group"
          aria-label={`Dependency injection composition, both revisions, ${units.length} registrations`}
          viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
          data-scale={scale}
          style={{width: bounds.width * scale, height: bounds.height * scale, visibility: scale ? undefined : 'hidden'}}
        >
          {units.map((unit, index) => (
            <DiffCard
              key={unit.id}
              unit={unit}
              diff={diff}
              emphasis={emphasis}
              selectedId={selectedId}
              onSelect={onSelect}
              clipId={`${markerId}-card-${index}`}
              inset={emphasisInset(borders)}
              fillInset={emphasisInset(borders) + borders.strong / 2}
            />
          ))}
          {links.map(link => (
            <LinkView
              key={link.key}
              link={link}
              route={routes.get(link.key)!}
              markerId={markerId}
              emphasis={emphasis(link, link.id)}
              labelled={selectedUnits.has(link.fromId) || selectedUnits.has(link.toId)}
              selectedId={selectedId}
              onSelect={onSelect}
              diff
            />
          ))}
          <LinkOrigins links={links} routes={routes} />
        </svg>
      </div>
    </div>
  )
}
