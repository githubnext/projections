import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {CSSProperties, ReactNode} from 'react'
import {connectorBetween, connectorPath, twoPaneMode} from '../modes.js'
import type {Connector, Side} from '../modes.js'
import {RendererPane} from '../pane.js'
import type {PaneState} from '../pane.js'
import type {ProjectionController} from '../projection.js'
import {paneArrangement, paneGeometry, useSize} from './arrangement.js'
import type {PaneArrangement} from './arrangement.js'
import {PaneBand, PaneChip, paneChipClearance} from './labels.js'
import {accent, columnGapOf, paneBleed, stageLayout} from './layout.js'
import type {PaneEdge, PaneLabels} from './layout.js'
import {DefaultStatus} from './status.js'
import {SwipeHandle} from './swipe-handle.js'

/** What a pane shows while its renderer loads or after it fails, if anything: `ProjectionStage`'s `renderStatus`. */
export type RenderStatus = ((pane: PaneState, side: Side | 'main') => ReactNode) | null | undefined

/** How far a pane chip sits from its pane's edge when the stage doesn't bleed: about where renderers start their content. */
const chipInset = 8

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

  // A held pane of side by side or swipe says so, so the renderer leaves out narration of the transition. A pane its
  // chip overlays is told how much of its top the chip takes (`stage-inset-top`), so its content starts below it.
  const chips = paneLabels === 'chips'
  const paneEnvironment = useMemo(() => {
    const {theme} = stage.environment
    const held = chips ? {...theme, tokens: {...theme.tokens, 'stage-inset-top': `${paneChipClearance}px`}} : theme
    return {
      before: {...stage.environment, theme: held, pane: 'before' as const},
      after: {...stage.environment, theme: held, pane: 'after' as const},
    }
  }, [stage.environment, chips])
  const status = (pane: PaneState, side: Side | 'main') =>
    renderStatus === null ? null : renderStatus ? (
      renderStatus(pane, side)
    ) : (
      <DefaultStatus pane={pane} title={renderer.title} reducedMotion={projection.reducedMotion} />
    )
  const pane = (side: Side) => (
    <RendererPane
      key="frame"
      renderer={renderer}
      documents={projection.rendererDocuments}
      {...(twoPanes ? {label: `${side} revision`} : {})}
      init={stage.init}
      progress={mode === 'diff' ? stage.diffProgress : twoPanes ? stage.endpoints[side] : stage.progressPayload}
      environment={twoPanes ? paneEnvironment[side] : stage.environment}
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
  // the divider reveals and hides it exactly with the area it names.
  const label = (side: Side) => {
    const align = mode === 'swipe' && side === 'after' ? 'right' : 'left'
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
      return (
        <PaneChip key="label" {...common} inset={bleed > 0 ? bleed - edge : chipInset}>
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
