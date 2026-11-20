import {useMemo, useRef, useState} from 'react'
import type {AnnotationMark} from '@githubnext/projections-renderer-sdk/protocol'
import type {RendererFrame} from '../frame.js'
import {twoPaneMode} from '../modes.js'
import type {ComparisonMode, Side} from '../modes.js'
import {loadingPane} from '../pane.js'
import type {PaneState} from '../pane.js'
import {themeStyle} from '../theme.js'
import {subjectRows, subjectVariation} from '../model.js'
import type {Variation} from '../model.js'
import type {Holds} from '../playback.js'
import {placeAnnotations} from '../targets/annotations.js'
import {summaryFigures} from '../summary.js'
import type {PaneKey, ProjectionController, ProjectionOptions} from './types.js'
import {speedRange, unit, useControllable} from './controllable.js'
import {useHostEnvironment} from './environment.js'
import {filterActions, filterState, useRowFilter} from './filtering.js'
import {usePlaybackPosition} from './playback-position.js'
import {usePlaybackActions} from './playback-actions.js'
import {usePlaybackLoop} from './playback-loop.js'
import {useRendererPayloads} from './payloads.js'
import {rendererState, useComparisonModes, useRendererControls} from './renderer-state.js'
import {useSelection} from './selection.js'
import type {Anchors} from './selection.js'
import {useStageBinding} from './stage-binding.js'

/**
 * The headless Projections host. It owns the state that must be correct and
 * secure (renderer frames and their protocol, progress, selection, pane sync,
 * comparison modes and settings) and renders nothing itself: pass the
 * controller to `ProjectionStage` for the renderer frames, and build controls
 * with any design system from its state and actions. Every value can be
 * controlled (pass it with its `on…Change` handler) or left to the core
 * (optionally seeded with `initial…`).
 */
export function useProjection(options: ProjectionOptions): ProjectionController {
  const {subject, projection} = options
  const comparing = subject.mode === 'comparison'
  const controllable = useControllable(options)
  const {latest, internal, setInternal, value, request} = controllable
  const {colorMode, theme, reducedMotion} = useHostEnvironment(options)

  const playing = comparing && value('playing')
  const loop = value('loop')
  const holds: Holds = value('holds') === 'pause' ? 'pause' : 'timeline'
  const speed = speedRange(value('speed'))
  const chosenMode = value('mode') as ComparisonMode | undefined
  const swipePosition = unit(value('swipePosition'))
  const highlighting = value('highlighting')
  const filters = filterState(comparing, value)
  const connector = value('connector')
  const selectedId = value('selectedId')
  const renderers = options.renderers ?? []
  const rendererName = value('rendererName')
  const renderer = renderers.find(entry => entry.name === rendererName) ?? renderers[0]
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [panes, setPanes] = useState<Record<PaneKey, PaneState>>({main: loadingPane, before: loadingPane, after: loadingPane})
  const {availableModes, modesKnown, mode, paneKeys} = useComparisonModes({request, comparing, renderer, chosenMode, panes})

  // The slider position and the presentation progress it shows.
  const timing = usePlaybackPosition({
    options,
    comparing,
    mode,
    panes,
    holds,
    speed,
    internalPosition: internal.position,
    reducedMotion,
  })
  const {position, progress, direction, toPosition, nextStep, previousStep, nextDirection} = timing
  const [anchors, setAnchors] = useState<Anchors>({before: {}, after: {}})
  const frames = useRef<Record<Side, RendererFrame | null>>({before: null, after: null})

  const rows = useMemo(() => subjectRows(subject), [subject])
  const variationKey = JSON.stringify(subjectVariation(subject, rows) ?? null)
  const variation = useMemo(() => (JSON.parse(variationKey) as Variation | null) ?? undefined, [variationKey])
  const placed = useMemo(() => placeAnnotations(subject, rows, options.annotations ?? []), [subject, rows, options.annotations])
  const marksKey = JSON.stringify(placed.marks)
  const annotationMarks = useMemo(() => JSON.parse(marksKey) as AnnotationMark[], [marksKey])
  const summaryItems = twoPaneMode(mode) ? (panes.after.summary ?? panes.before.summary) : panes.main.summary
  const summaryKey = JSON.stringify(summaryItems ?? null)
  const summary = useMemo(() => summaryFigures(subject, JSON.parse(summaryKey) ?? undefined), [subject, summaryKey])
  const {visibleRows, filter, counts: scopeCounts, hidden: scopeHidden} = useRowFilter(rows, subject, filters, summary)
  const payloads = useRendererPayloads({options, renderer, mode, progress, direction, highlighting, theme, reducedMotion})
  const controls = useRendererControls({latest, internal, setInternal, options, renderer, panes, paneKeys})
  const status = rendererState(renderer, panes, paneKeys)

  const playback = usePlaybackActions({...controllable, ...timing, playing, loop, speed, reducedMotion})
  const {seek, play, requestPlaying, playingRef} = playback
  const selection = useSelection({latest, request, subject, rows, selectedId, placed, anchors, frames})
  usePlaybackLoop({...playback, ...timing, playing, reducedMotion, mode})

  // A new subject starts over, before the next commit.
  const [shownSubject, setShownSubject] = useState(subject)
  if (shownSubject !== subject) {
    setShownSubject(subject)
    timing.travelled.current = false
    setInternal(previous => ({
      ...previous,
      position: subject.mode === 'comparison' ? unit(options.initialPosition ?? toPosition(options.initialProgress ?? 1)) : 1,
      playing: false,
      selectedId: options.initialSelectedId ?? null,
    }))
    setHoveredId(null)
    setAnchors({before: {}, after: {}})
    selection.setPinned(null)
  }

  const stage = useStageBinding({
    payloads,
    stableValues: controls.stableValues,
    action: controls.action,
    filter,
    anchors,
    frames,
    setPanes,
    setAnchors,
    selectFrom: selection.selectFrom,
    activateAnnotation: selection.activateAnnotation,
    selectedPath: selection.selectedPath,
    annotationMarks,
  })

  return {
    subject,
    comparing,
    projection,
    rows,
    visibleRows,
    selectedRow: selectedId === null ? undefined : rows.find(row => row.id === selectedId),
    notices: [...(options.rendererNotice ? [options.rendererNotice] : []), ...(options.notices ?? []), ...controls.notices],
    rendererErrors: status.errors,
    theme,
    colorMode,
    themeStyle: themeStyle(theme),
    reducedMotion,
    renderer,
    renderers,
    rendererDocuments: options.rendererDocuments,
    rendererStatus: status.status,
    panes,
    renderedProgress: panes.main.rendered,
    position,
    progress,
    holds,
    playing,
    direction,
    loop,
    durationMs: timing.durationMs,
    baseDurationMs: timing.baseDurationMs,
    speed,
    stepEnds: timing.stepEnds,
    stepPositions: timing.stepPositions,
    nextStep,
    previousStep,
    mode,
    availableModes,
    modesKnown,
    swipePosition,
    highlighting,
    scope: filters.scope,
    scopeCounts,
    scopeHidden,
    changesOnly: filters.changesOnly,
    variedOnly: filters.variedOnly,
    regeneratedOnly: filters.regeneratedOnly,
    variation,
    summary,
    summaryFilter: filters.summaryFilter,
    connector,
    search: filters.search,
    selectedId,
    selection: selection.selection,
    hoveredId,
    annotationMarks,
    annotationsFor: rowId => placed.byRow.get(rowId) ?? [],
    unplacedAnnotations: placed.unplaced,
    controls: controls.controls,
    controlValues: controls.stableValues,
    legend: twoPaneMode(mode) ? (panes.after.legend ?? panes.before.legend) : panes.main.legend,
    seek,
    seekProgress: next => seek(toPosition(unit(next))),
    play,
    pause: playback.pause,
    toggle: playback.toggle,
    nextDirection,
    togglePlayback: () => {
      if (playingRef.current) requestPlaying(false)
      else play(nextDirection)
    },
    stepForward: () => {
      if (nextStep !== undefined) seek(nextStep)
    },
    stepBack: () => {
      if (previousStep !== undefined) seek(previousStep)
    },
    setSpeed: next => {
      if (Number.isFinite(next) && next > 0) request('speed', speedRange(next))
    },
    setLoop: next => request('loop', next),
    setHolds: next => request('holds', next),
    setMode: next => request('mode', next),
    setSwipePosition: next => request('swipePosition', unit(next)),
    setHighlighting: next => request('highlighting', next),
    ...filterActions(filters, value, request),
    setConnector: next => request('connector', next),
    select: id => selection.selectRow(id),
    selectTarget: selection.selectTarget,
    resolveTarget: selection.resolve,
    activateAnnotation: selection.activateAnnotation,
    anchorFor: selection.anchorFor,
    hover: id => setHoveredId(id),
    setRenderer: name => {
      if (renderers.some(entry => entry.name === name)) request('rendererName', name)
    },
    setControl: controls.setControl,
    runAction: controls.runAction,
    openSource: (path, line) => latest.current.onOpen?.(path, line),
    stage,
  }
}
