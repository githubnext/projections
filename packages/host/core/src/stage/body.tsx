import {useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode} from 'react'
import {connectorBetween, connectorPath, twoPaneMode, type Connector, type Side} from '../modes.js'
import {RendererPane, type PaneState} from '../pane.js'
import type {ProjectionController} from '../projection.js'
import {paneArrangement, paneGeometry, useSize, type PaneArrangement} from './arrangement.js'
import {PaneBand, PaneChip} from './labels.js'
import {accent, columnGapOf, stackedGapsOf, paneBleed, stageLayout, type PaneEdge, type PaneLabels} from './layout.js'
import {bothPanesLoading, DefaultStatus, StageStatus} from './status.js'
import {coverTokens, useFrameCovers, type FrameCover} from './cover.js'
import {UtilityArea} from './utility.js'
import {SwipeHandle} from './swipe-handle.js'

/** What a pane shows while its renderer loads or after it fails, if anything: `ProjectionStage`'s `renderStatus`. */
export type RenderStatus = ((pane: PaneState, side: Side | 'main') => ReactNode) | null | undefined

/**
 * How far a pane chip sits from its pane's edge when the stage doesn't bleed: where renderers start their content, the
 * renderer kit's stage padding (`pk-stage`, `ContentView`) without a host `stage-inset`, so the chip's edge lines up
 * with the tables and cards under it.
 */
const chipInset = 12

/** The widest a swipe chip is, CSS px: half the stage less its inset and a gap at the middle, in whole pixels. */
const swipeChipWidth = (width: number, inset: number) =>
  Number.isFinite(width) ? Math.max(0, Math.floor(width / 2) - inset - 4) : undefined

/** The panes of `ProjectionStage` for the mode: one frame, side by side's two cards, or swipe's two layers. */
export function StageBody({
  projection,
  beforeLabel,
  afterLabel,
  stackBelow,
  renderStatus,
  fill,
  paneEdge,
  bleed = 0,
  paneLabels = 'visible',
  utility,
  foot,
}: {
  projection: ProjectionController
  beforeLabel: ReactNode
  afterLabel: ReactNode
  stackBelow: number
  renderStatus: RenderStatus
  fill: boolean
  paneEdge: PaneEdge
  bleed?: number
  paneLabels?: PaneLabels
  utility?: ReactNode
  foot?: ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)
  const id = useId()
  const {stage, selectedId, mode} = projection
  const renderer = projection.renderer!
  const twoPanes = twoPaneMode(mode)
  const {width, height} = useSize(container)
  // The arrangement is chosen from the content's shape (the renderer's framing over the whole transition, so it holds
  // while scrubbing) and kept per comparison unless the other one fits clearly larger.
  const aspect = projection.panes.after.aspect ?? projection.panes.before.aspect
  const arranged = useRef<{subject: unknown; arrangement: PaneArrangement | undefined}>({subject: undefined, arrangement: undefined})
  if (arranged.current.subject !== projection.subject) arranged.current = {subject: projection.subject, arrangement: undefined}
  const arrangement = paneArrangement({
    width,
    height: fill ? height : 0,
    aspect,
    stackBelow,
    current: arranged.current.arrangement,
    columnGap: columnGapOf(paneEdge),
    ...stackedGapsOf(paneEdge),
    // Chips overlay their frames, so only header bands take height from the panes.
    band: paneLabels === 'visible' ? paneGeometry.band : 0,
  })
  // Kept only once it was chosen from the content's shape, so the first real choice isn't held back by a default.
  if (mode === 'side-by-side' && fill && aspect && height > 0 && Number.isFinite(width)) arranged.current.arrangement = arrangement
  const stacked = mode === 'side-by-side' && arrangement === 'stacked'
  const [layout, setLayout] = useState(0)
  const [connector, setConnector] = useState<Connector>()
  const [focused, setFocused] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const element = container.current
    if (!element || mode !== 'side-by-side') return
    const bump = () => setLayout(value => value + 1)
    const observer = new ResizeObserver(bump)
    observer.observe(element)
    for (const child of element.querySelectorAll('.ph-pane')) observer.observe(child)
    window.addEventListener('resize', bump)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', bump)
    }
  }, [mode])
  useLayoutEffect(() => {
    const element = container.current
    const from = selectedId === null ? undefined : stage.anchors.before[selectedId]
    const to = selectedId === null ? undefined : stage.anchors.after[selectedId]
    const left = stage.frames.current.before?.iframe
    const right = stage.frames.current.after?.iframe
    setConnector(
      projection.connector && mode === 'side-by-side' && element && from && to && left?.isConnected && right?.isConnected
        ? connectorBetween(left, right, from, to, element.getBoundingClientRect())
        : undefined,
    )
  }, [stage.anchors, stage.frames, selectedId, layout, stacked, mode, projection.connector])

  // What the stage overlays on each frame (the chips, the utility area) is measured in the frame's own coordinates and
  // sent as its `stage-cover`, with the band it takes at the top as its `stage-inset-top`, so a renderer that honours
  // them keeps its content clear of the cover (a fitted canvas only where it would reach it) and shows under it.
  const chips = paneLabels === 'chips'
  const utilityShown = Boolean(utility) && !twoPanes
  const frames = useCallback(
    () => ({before: stage.frames.current.before?.iframe, after: stage.frames.current.after?.iframe}),
    [stage.frames],
  )
  const covers = useFrameCovers(
    container,
    frames,
    // What overlays exist, where the frames are, and the stage's size: a frame that mounts after the hook subscribed is
    // only observed from the next run, which a size or status change brings.
    `${mode}-${stacked}-${chips}-${utilityShown}-${Boolean(foot)}-${layout}-${width}-${height}-${projection.panes.before.status}-${projection.panes.after.status}`,
    projection.reducedMotion,
  )
  // A held pane of side by side or swipe says so, so the renderer leaves out narration of the transition. The covers
  // are measured before the frames first load, so a renderer opens with them; `covers` keeps its identity until they
  // change.
  const paneEnvironment = useMemo(() => {
    const {theme} = stage.environment
    const covered = (cover: FrameCover | undefined) => (cover ? {...theme, tokens: {...theme.tokens, ...coverTokens(cover)}} : theme)
    const afterTheme = covered(covers.after)
    return {
      before: {...stage.environment, theme: twoPanes ? covered(covers.before) : theme, pane: 'before' as const},
      after: {...stage.environment, theme: afterTheme, pane: 'after' as const},
      main: afterTheme === theme ? stage.environment : {...stage.environment, theme: afterTheme},
    }
  }, [stage.environment, covers, twoPanes])
  const paneStatus = (pane: PaneState, side: Side | 'main') =>
    renderStatus === null ? null : renderStatus ? (
      renderStatus(pane, side)
    ) : (
      <DefaultStatus pane={pane} title={renderer.title} reducedMotion={projection.reducedMotion} />
    )
  // While both panes load, one status says so, centred on the stage (`StageStatus`), not one centred in each pane.
  const bothLoading = bothPanesLoading(projection.panes, twoPanes)
  const status = bothLoading ? () => null : paneStatus
  const pane = (side: Side) => (
    <RendererPane
      key="frame"
      renderer={renderer}
      documents={projection.rendererDocuments}
      {...(twoPanes ? {label: `${side} revision`} : {})}
      init={stage.init}
      progress={mode === 'diff' ? stage.diffProgress : twoPanes ? stage.endpoints[side] : stage.progressPayload}
      environment={twoPanes ? paneEnvironment[side] : paneEnvironment.main}
      options={stage.options}
      action={stage.action}
      filter={stage.filter}
      selectedId={selectedId}
      hoveredId={projection.hoveredId}
      comparing={twoPanes || projection.comparing}
      onSelect={stage.onSelect[twoPanes ? side : 'main']}
      onHover={projection.hover}
      onOpen={projection.openSource}
      selectedPath={stage.selectedPath[twoPanes ? side : 'main']}
      annotations={stage.annotations}
      onAnnotation={stage.onAnnotation}
      onControl={projection.setControl}
      fill={fill}
      onAnchor={stage.onAnchor[side]}
      onState={twoPanes ? stage.onPaneState[side] : stage.onPaneState.main}
      frameRef={stage.onFrame[side]}
      {...(bleed > 0 ? {bleed: paneBleed(mode, stacked, twoPanes ? side : 'main', bleed)} : {})}
      {...(mode === 'swipe' ? {onViewport: stage.onViewport[side]} : {})}
      status={status}
    />
  )
  // Each pane's label is a header band above it, inside its section, or a chip overlaid on its frame's top corner. In
  // swipe each label lives in its own clipped layer (the before label at the left, the after label at the right), so
  // the divider reveals and hides it exactly with the area it names. Side by side's chips do the same in columns: the
  // left pane's at its left, the right pane's at its right.
  const label = (side: Side) => {
    const outer = mode === 'swipe' || (chips && mode === 'side-by-side' && !stacked)
    const align = outer && side === 'after' ? 'right' : 'left'
    const common = {
      side,
      id: `${id}-${side}`,
      as: mode === 'side-by-side' ? ('h3' as const) : ('span' as const),
      className: mode === 'swipe' ? 'ph-swipe-label' : 'ph-pane-label',
      align,
    } as const
    if (chips) {
      // The chip starts where the renderer's content does: the stage inset the frame is given, less how far it bleeds.
      const edge = paneBleed(mode, stacked, side, bleed)[align === 'left' ? 'start' : 'end']
      const inset = bleed > 0 ? bleed - edge : chipInset
      // Keyed by its tag, so a chip whose root changes (`h3` in side by side, `span` in swipe) mounts again and its
      // whole-pixel alignment follows the new element.
      return (
        <PaneChip
          key={`label-${common.as}`}
          {...common}
          inset={inset}
          maxWidth={mode === 'swipe' ? swipeChipWidth(width, inset) : undefined}
        >
          {side === 'before' ? beforeLabel : afterLabel}
        </PaneChip>
      )
    }
    return (
      <PaneBand key="label" {...common} hidden={paneLabels === 'hidden'}>
        {side === 'before' ? beforeLabel : afterLabel}
      </PaneBand>
    )
  }

  const position = projection.swipePosition
  const percent = `${Math.round(position * 1000) / 10}%`
  const set = projection.setSwipePosition
  const {sectionStyle, sectionClass, bodyStyle} = stageLayout({mode, fill, stacked, percent, paneEdge, bleed})

  // Keys keep the after section (and its frame) in place when the before section and mode extras come and go.
  return (
    <div
      ref={container}
      className={`ph-stage-body ${mode === 'swipe' ? 'ph-swipe' : mode === 'side-by-side' ? 'ph-panes' : 'ph-single-stage'}`}
      {...(mode === 'side-by-side'
        ? {
            'data-stacked': stacked || undefined,
            'data-content-aspect': aspect,
            'data-connector': connector ? (connector.vertical ? 'vertical' : 'horizontal') : 'none',
          }
        : {})}
      style={bodyStyle}
    >
      {twoPanes && (
        <section
          key="before"
          className={sectionClass('before')}
          aria-labelledby={`${id}-before`}
          data-side="before"
          data-pane-card=""
          style={sectionStyle('before')}
        >
          {label('before')}
          {pane('before')}
        </section>
      )}
      <section
        key="after"
        className={sectionClass('after')}
        aria-labelledby={twoPanes ? `${id}-after` : undefined}
        data-side={twoPanes ? 'after' : undefined}
        data-pane-card={twoPanes ? '' : undefined}
        style={sectionStyle('after')}
      >
        {/* First, so keyboard focus reaches the stage's controls before the frame they float over. */}
        {utilityShown && <UtilityArea key="utility">{utility}</UtilityArea>}
        {twoPanes && label('after')}
        {pane('after')}
      </section>
      {connector && (
        <svg
          key="connector"
          className="ph-connector"
          aria-hidden="true"
          style={{position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none', zIndex: 1}}
        >
          <path d={connectorPath(connector)} fill="none" stroke={accent} strokeWidth={2} />
          <circle cx={connector.x1} cy={connector.y1} r="4" fill={accent} data-end="before" />
          <circle cx={connector.x2} cy={connector.y2} r="4" fill={accent} data-end="after" />
        </svg>
      )}
      {foot}
      {/* The stage's status speaks for both panes, so it names neither: `main`, as one frame's does. */}
      {bothLoading && <StageStatus>{paneStatus(projection.panes.after, 'main')}</StageStatus>}
      {mode === 'swipe' && (
        <SwipeHandle
          key="handle"
          container={container}
          position={position}
          onChange={set}
          beforeLabel={beforeLabel}
          focused={focused}
          onFocusedChange={setFocused}
          dragging={dragging}
          onDraggingChange={setDragging}
        />
      )}
    </div>
  )
}
