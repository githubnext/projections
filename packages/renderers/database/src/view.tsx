import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {fitScale} from '@githubnext/projections-renderer-kit'
import {
  EmptyDomain,
  Notice,
  useContentAspect,
  useFrameFill,
  useFrameSizing,
  useOpeningFloor,
  useStageHeightCap,
  useStageZoom,
} from '@githubnext/projections-renderer-kit/react'
import type {RendererProps} from '@githubnext/projections-renderer-kit/react'
import {rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import type {accepts} from './accepts.js'
import {createDatabaseTransition} from './transition.js'
import {createDatabaseDiff} from './diff.js'
import {useTextMeasure} from './measure.js'
import {DatabaseTags, tagLimit} from './tags.js'
import {Link, LinkHead} from './links-view.js'
import {linkNamer} from './link-names.js'
import {Table} from './table.js'
import type {SchemaFrame} from './frame.js'
import {morphSchemaFrame} from './morph.js'
import {useNaturalHeight, useViewSize} from './view-size.js'

/** The document's identity while the host hasn't said what it shows. */
const provisional = Symbol('provisional')

/** How long cards, rows and links move to a new layout of the schema. */
const moveMs = 320

/**
 * The frame to draw: `frame`, or while the schema moves to a new layout of the same `document` (a new `layout`, as
 * when the scope changes or a fold opens or closes), a frame between the one drawn before and it, so cards, rows and
 * links glide to their new places, the links attached throughout. Another document, zoom, scrubbing and resizing
 * draw `frame` at once, as does everything under reduced motion. Also whether it's moving.
 */
function useFrameMorph(frame: SchemaFrame, layout: unknown, document: unknown, reducedMotion: boolean): [SchemaFrame, boolean] {
  const drawn = useRef(frame)
  const seen = useRef({layout, document})
  const [move, setMove] = useState<{from: SchemaFrame; mix: number}>()
  useLayoutEffect(() => {
    const same = seen.current.document === document
    if (seen.current.layout === layout || !same || reducedMotion) {
      seen.current = {layout, document}
      setMove(undefined)
      return
    }
    seen.current = {layout, document}
    // From what was drawn last, which may itself be mid-move.
    const from = drawn.current
    let start: number | undefined
    let handle = 0
    const step = (now: number) => {
      start ??= now
      const t = Math.min(1, (now - start) / moveMs)
      setMove(t >= 1 ? undefined : {from, mix: 1 - (1 - t) ** 3})
      if (t < 1) handle = requestAnimationFrame(step)
    }
    setMove({from, mix: 0})
    handle = requestAnimationFrame(step)
    return () => cancelAnimationFrame(handle)
  }, [layout, document, reducedMotion])
  const shown = move ? morphSchemaFrame(move.from, frame, move.mix) : frame
  useLayoutEffect(() => {
    drawn.current = shown
  })
  return [shown, move !== undefined]
}

export function DatabaseRenderer(props: RendererProps<typeof accepts>) {
  const {model, schedule, progress} = props
  const view = useRef<HTMLDivElement>(null)
  const {available, stage} = useViewSize(view)
  const sizing = useFrameSizing()
  // Fills the frame and centres the schema; a content-sized host gets the schema's own height.
  const content = useRef<HTMLDivElement>(null)
  const natural = useNaturalHeight(content)
  const diff = props.diff && props.comparing
  const links = props.controls.showRelationships !== false
  const text = useTextMeasure()
  const transition = useMemo(
    () =>
      diff
        ? undefined
        : createDatabaseTransition(model, schedule, {
            available,
            links,
            ...(text.measure ? {measure: text.measure} : {}),
            chrome: text.chrome,
          }),
    [diff, model, schedule, available, links, text.measure, text.chrome],
  )
  const union = useMemo(
    () =>
      diff
        ? createDatabaseDiff(model, {available, links, ...(text.measure ? {measure: text.measure} : {}), chrome: text.chrome})
        : undefined,
    [diff, model, available, links, text.measure, text.chrome],
  )
  // Before the host's filter, every table is drawn provisionally: the first scope it chooses is drawn at once.
  const document = props.filtered === false ? provisional : (props.scope?.all ?? model)
  const [frame, moving] = useFrameMorph(union ? union.frame : transition!(progress), model, document, props.reducedMotion)
  const tagSource = union ?? transition!
  const tableCount = (union ? union.layout : transition!.layouts.at(-1)!).tables.size
  // Opens with the whole schema in view, fitted to the stage (never magnified); zoom enlarges it. Every step shares
  // the transition's width and height, so the fit never changes while scrubbing.
  const width = Math.max(available, Math.ceil(frame.width))
  // A host that gives the frame the height it reports will make room for the schema's height: fit the width from the
  // first paint, not the height the frame has before the host answers.
  const room = stage && {width: stage.width, height: sizing === 'content' ? rendererLimits.maxHeight - stage.padding : stage.height}
  const fit = room && natural && room.width > 0 && room.height > 0 ? fitScale({width, height: natural}, room, {padding: 0}).scale : 1
  // Unless fitting would draw its smallest text below the kit's opening floor: then it opens at that, at its top left,
  // and scrolls.
  const floor = useOpeningFloor(content, tagSource)
  const {zoom, scale} = useStageZoom(view, props.onAction, fit, {floor})
  // A content-sized host gets the schema's own height; zoomed in, the height it is drawn at, up to the room the host
  // allows (its stage-max-height, else the protocol's maximum), so the stage grows into the page before it pans.
  const cap = useStageHeightCap()
  useFrameFill(
    natural === undefined || !stage
      ? undefined
      : Math.ceil(Math.max(natural, Math.min(natural * scale, (cap ?? rendererLimits.maxHeight) - stage.padding)) + stage.padding),
  )
  useContentAspect(natural ? width / natural : undefined)
  useEffect(() => {
    if (props.selectedId === null) return
    view.current
      ?.querySelector(`[data-entity-id="${CSS.escape(props.selectedId)}"]`)
      ?.scrollIntoView?.({block: 'nearest', inline: 'nearest'})
  }, [props.selectedId])
  const empty = !model.entities.length
  const linkName = linkNamer(frame)
  return (
    <div
      className="database-view pk-stage"
      ref={view}
      data-projections-scroll="database"
      data-layout={frame.mode}
      data-zoom={zoom}
      data-diff={diff ? '' : undefined}
      data-moving={moving ? '' : undefined}
    >
      {text.probe}
      <div className="database-zoom" style={{width: width * scale, height: natural === undefined ? undefined : natural * scale}}>
        <div
          className="database-content"
          ref={content}
          data-scale={scale}
          style={{width, transform: scale === 1 ? undefined : `scale(${scale})`}}
        >
          {empty && <EmptyDomain>No database entities in this {props.comparing ? 'comparison' : 'extraction'}.</EmptyDomain>}
          {!empty && (
            <p className="sr-only" role="status">
              {tableCount} tables, {frame.links.length} relationships shown.
            </p>
          )}
          {/* Kept while a step has no tables, so the framing never changes while scrubbing. */}
          {frame.height > 0 && (
            <div className="database-canvas" style={{width: frame.width, height: frame.height}}>
              <svg className="database-links" width={frame.width} height={frame.height} role="group" aria-label="Relationships">
                {frame.links.map((link, index) => (
                  <Link
                    key={link.key}
                    link={link}
                    props={props}
                    name={linkName(link)}
                    focusable={frame.links.findIndex(other => other.relationship === link.relationship) === index}
                    diff={diff}
                  />
                ))}
              </svg>
              {frame.tables.map(table => (
                <Table key={table.change.id} table={table} props={props} diff={diff} wrap={(union ?? transition!).lines} />
              ))}
              <svg className="database-links database-arrowheads" width={frame.width} height={frame.height} aria-hidden="true">
                {/* A many-to-many relationship has no principal to point at. */}
                {frame.links
                  .filter(link => link.type !== 'many-to-many')
                  .map(link => (
                    <LinkHead key={link.key} link={link} props={props} />
                  ))}
              </svg>
            </div>
          )}
          <DatabaseTags transition={tagSource} frame={frame} props={props} minWidth={frame.width} />
          <Notice shown={Math.min(tagLimit, tagSource.tags.length)} total={tagSource.tags.length} noun="keys and indexes" />
        </div>
      </div>
    </div>
  )
}
