import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {FocusEvent, PointerEvent} from 'react'
import {paletteLegend} from '@githubnext/projections-renderer-kit'
import {EmptyDomain, Notice, useLegend, usePaintGate} from '@githubnext/projections-renderer-kit/react'
import type {RendererProps} from '@githubnext/projections-renderer-kit/react'
import type {RendererProjection} from '@githubnext/projections-renderer-sdk/protocol'
import {formatSize, legendTitle, categoryOf, weightOf} from './files.js'
import type {SizeMeasure} from './files.js'
import {createPackingTransition, diffPacking} from './transition.js'
import type {Circle} from './transition.js'
import type {PackSettings} from './pack/hierarchy.js'
import type {accepts} from './accepts.js'
import {depthControl, exclusionControls, folderControls, measureControl} from './controls.js'
import {Circles, layoutMark, labelsMark, RootSurface} from './circles.js'
import {diffViewBox, drawCircle, withHolders, includedRows, packingDocument, packingPalette, sizeWords} from './document.js'
import type {Exclusions} from './document.js'
import {nameOf, placeLabels} from './labels.js'
import {useLabelSize, useStageSize} from './stage.js'
import {Tooltip} from './tooltip.js'

/** Most circles drawn; the smallest beyond it are left out with a notice. */
const circleLimit = 6000

export function FilePackingRenderer(props: RendererProps<typeof accepts>) {
  const {model, schedule, progress, selectedId, onSelect, locale, diff, controls, colorMode} = props
  const stage = useRef<HTMLDivElement>(null)
  const size = useStageSize(stage)
  const font = useLabelSize()
  usePaintGate(size !== undefined)

  const doc = useMemo(() => packingDocument(model), [model])

  const folders = useMemo(() => folderControls(doc.repository ? doc.topNames : []), [doc])
  const declared = useMemo(
    () => [
      depthControl(doc.depth),
      ...(doc.lines ? [measureControl] : []),
      ...(doc.repository ? exclusionControls : []),
      ...folders.controls,
    ],
    [doc, folders],
  )
  const {declareControls} = props
  useEffect(() => declareControls(declared), [declareControls, declared])

  const measure: SizeMeasure = doc.lines && controls.measure === 'lines' ? 'lines' : 'bytes'
  const maxDepth = typeof controls.maxDepth === 'number' ? Math.max(1, Math.round(controls.maxDepth)) : doc.depth
  const hidden = [...folders.ids].filter(([, id]) => controls[id] === false).map(([name]) => name)
  const exclusions: Exclusions = {
    dependencies: doc.repository && controls.hideDependencies === true,
    lockfiles: doc.repository && controls.hideLockfiles === true,
    hidden: hidden.join('\n'),
  }
  const exclusionKey = JSON.stringify(exclusions)
  const include = useMemo(() => includedRows(model, doc, JSON.parse(exclusionKey) as Exclusions), [model, doc, exclusionKey])

  // The definition's kind colors (`presentation.kinds`); keyed by content, so a new init with the same kinds keeps the palette.
  const kindsKey = JSON.stringify(props.init.projection?.kinds ?? {})
  const kinds = useMemo(() => JSON.parse(kindsKey) as NonNullable<RendererProjection['kinds']>, [kindsKey])
  const palette = useMemo(
    () => packingPalette(model, include, doc, measure, colorMode, kinds),
    [model, include, doc, measure, colorMode, kinds],
  )
  const legend = useMemo(() => paletteLegend(palette, legendTitle(doc.mode, measure, doc.flags)), [palette, doc, measure])
  useLegend(props.reportLegend, legend)

  const settings: PackSettings = useMemo(
    () => ({
      weight: entity => weightOf(entity, measure),
      category: entity => categoryOf(entity, doc.mode).key,
      maxDepth,
    }),
    [measure, doc, maxDepth],
  )
  const area = size ?? {width: 1000, height: 620, fit: 1}
  const width = area.width,
    height = area.height,
    fit = area.fit
  const transition = useMemo(
    () => (diff ? undefined : createPackingTransition(model, schedule, settings, {width, height}, include)),
    [diff, model, schedule, settings, width, height, include],
  )
  const differ = useMemo(
    () => (diff ? diffPacking(model, settings, {width, height}, include) : undefined),
    [diff, model, settings, width, height, include],
  )
  // Everything below depends on progress, size and settings, never on hover or focus: hovering only re-renders the tooltip.
  const all = useMemo(() => {
    performance.mark(layoutMark)
    return differ ? differ.circles : transition!.frame(progress)
  }, [differ, transition, progress])
  const ends = useMemo(
    () => (differ ? {first: differ.before, last: differ.after} : {first: transition!.first, last: transition!.last}),
    [differ, transition],
  )

  // A diff may extend past the area (removed files stay where they were); it is scaled down to fit, labels included.
  const view = useMemo(
    () => (differ ? diffViewBox(differ.packing.bounds, width, height) : {x: 0, y: 0, width, height, scale: 1}),
    [differ, width, height],
  )

  // A single root holding everything is the background: selectable, but not a circle around the spread-out top level.
  const root = differ ? (differ.packing.root === undefined ? undefined : {id: differ.packing.root, opacity: () => 1}) : transition!.root
  const rootRow = root ? model.entities.find(row => row.id === root.id) : undefined
  const rootValue = useMemo(() => all.reduce((sum, circle) => sum + (circle.depth === 1 ? circle.value : 0), 0), [all])
  const circles = useMemo(() => (all.length > circleLimit ? [...all].sort((a, b) => b.r - a.r).slice(0, circleLimit) : all), [all])
  const byId = useMemo(() => new Map(all.map(circle => [circle.id, circle])), [all])
  const [focused, setFocused] = useState<string | null>(null)
  const [pointed, setPointed] = useState<string | null>(null)
  const tipId = pointed ?? focused ?? props.hoveredId
  const tip = tipId ? byId.get(tipId) : undefined
  const charWidth = font * 0.62
  const decorations = useMemo(() => {
    performance.mark(labelsMark)
    return placeLabels(circles, doc.paths, charWidth, font)
  }, [circles, doc, charWidth, font])

  const comparing = props.comparing
  const describeSize = useCallback(
    (circle: Circle) => sizeWords(circle, ends, measure, locale, comparing),
    [ends, measure, locale, comparing],
  )

  const emphasisOf = props.emphasis
  const drawn = useMemo(
    () => withHolders(circles.map(circle => drawCircle(circle, {doc, decorations, emphasisOf, palette, onSelect, describeSize, diff}))),
    [circles, decorations, doc, emphasisOf, palette, onSelect, describeSize, diff],
  )
  const shown = circles === all ? undefined : circles.length
  // Pointer and focus are tracked once on the canvas (by the entity under them), not on every circle.
  const point = useCallback((event: PointerEvent) => setPointed(entityOf(event.target)), [])
  const unpoint = useCallback(() => setPointed(null), [])
  const focus = useCallback((event: FocusEvent) => setFocused(entityOf(event.target)), [])
  const unfocus = useCallback(() => setFocused(null), [])

  const rootLabel = doc.root ? ` in ${model.entities.find(row => row.id === doc.root)?.after?.label ?? 'the repository'}` : ''
  const packingLabel = `Files packed by ${measure === 'lines' ? 'lines' : 'size'}${rootLabel}`

  return (
    <div className="fp-view">
      {shown !== undefined && <Notice shown={shown} total={all.length} noun="circles" />}
      <div className="fp-stage pk-stage" ref={stage} data-projections-scroll="file-packing">
        {!all.length ? (
          <EmptyDomain>There is nothing with a positive size to pack at this point.</EmptyDomain>
        ) : (
          <div className="fp-canvas" style={{width: width * fit, height: height * fit}}>
            <svg
              viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
              className="fp-packing"
              role="group"
              aria-label={packingLabel}
              width={width * fit}
              height={height * fit}
              data-scale={view.scale * fit}
              style={{visibility: size ? undefined : 'hidden'}}
              onPointerOver={point}
              onPointerLeave={unpoint}
              onFocus={focus}
              onBlur={unfocus}
            >
              {rootRow && root && (
                <RootSurface
                  id={rootRow.id}
                  label={`Folder ${(rootRow.after ?? rootRow.before)!.label}, the whole hierarchy, ${formatSize(rootValue, measure, locale)}`}
                  opacity={root.opacity(progress)}
                  selected={selectedId === rootRow.id}
                  onSelect={onSelect}
                  view={view}
                />
              )}
              <Circles drawn={drawn} selectedId={selectedId} arcIds={doc.arcIds} />
            </svg>
            {tip && (
              <Tooltip
                circle={tip}
                path={doc.paths.get(tip.id) || nameOf((tip.row.after ?? tip.row.before)!, undefined)}
                sizes={describeSize(tip)}
                category={
                  tip.filled && tip.category !== undefined ? (palette.entry(tip.category)?.category.label ?? tip.category) : undefined
                }
                flags={drawn.find(item => item.id === tip.id)?.flags.map(flag => flag.label) ?? []}
                view={view}
                area={{width, height}}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** The entity an event target belongs to, if any. */
function entityOf(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest('[data-entity-id]')?.getAttribute('data-entity-id') ?? null) : null
}
