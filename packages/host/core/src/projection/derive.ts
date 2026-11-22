// The projection as a function of its state and the embedder's options: `read` derives the whole controller, and
// `settle` the state changes a render implies (a new subject starts over; a renderer's declared controls take the
// definition's defaults). Both are pure, so React may render and discard a read; only `commit` keeps what one used.
import {isControlValue} from '@githubnext/projections-renderer-sdk/protocol'
import type {AnnotationMark, SummaryItem} from '@githubnext/projections-renderer-sdk/protocol'
import type {RendererFrame} from '../frame.js'
import type {ComparisonMode, Side} from '../modes.js'
import {twoPaneMode} from '../modes.js'
import type {Variation, ViewSubject} from '../model.js'
import {subjectRows, subjectVariation} from '../model.js'
import type {PaneState} from '../pane.js'
import {loadingPane} from '../pane.js'
import {endpointHoldMs, holdDuration, stepHoldMs} from '../playback.js'
import type {Holds} from '../playback.js'
import {summaryFigures} from '../summary.js'
import {placeAnnotations} from '../targets/annotations.js'
import {resolveTarget, rowTargets} from '../targets/target.js'
import type {ProjectionSelection, ProjectionTarget, TargetAnnotation} from '../targets/target.js'
import {themeStyle} from '../theme.js'
import type {RequestChange, ValueOf} from './controllable.js'
import {speedRange, unit} from './controllable.js'
import {createHostEnvironment, noMedia} from './environment.js'
import type {Media} from './environment.js'
import {createRowFilter, filterActions, filterState} from './filtering.js'
import {initialInteraction} from './interaction.js'
import type {Interaction, InteractionEvent} from './interaction.js'
import {createMemos} from './memo.js'
import {paintState} from './paint.js'
import type {PaintState} from './paint.js'
import {createRendererPayloads} from './payloads.js'
import type {PlaybackController} from './playback-controller.js'
import {nextDirection} from './playback-lifecycle.js'
import type {PlaybackLifecycle, PlaybackRun} from './playback-lifecycle.js'
import {createPlaybackPosition} from './playback-position.js'
import type {PlaybackPosition} from './playback-position.js'
import {createComparisonModes, createControlValues, rendererState, seedControls, unseeded} from './renderer-state.js'
import type {DeclaredModes, SeededControls} from './renderer-state.js'
import {anchorOf, selectedPaths, selectedTarget, selectionOf, targetSelection} from './selection.js'
import {initialSettings, restartedSettings, settingValue} from './settings-store.js'
import type {Settings} from './settings-store.js'
import {createStageBinding} from './stage-binding.js'
import type {StageHandlers} from './stage-binding.js'
import type {PaneKey, ProjectionController, ProjectionOptions, RendererStatus} from './types.js'

/** Everything the core holds for one projection: what the embedder's options and the renderers' reports don't say. */
export interface ProjectionState {
  /** The subject the rest belongs to: a new one starts over. */
  readonly subject: ViewSubject
  readonly settings: Settings
  readonly panes: Readonly<Record<PaneKey, PaneState>>
  readonly interaction: Interaction
  readonly declaredModes: DeclaredModes
  readonly seeded: SeededControls
  /** The last action run, counted so running it again is news. */
  readonly action: {readonly id: string; readonly sequence: number} | undefined
  readonly media: Media
  readonly playback: PlaybackLifecycle
}

const loadingPanes: Record<PaneKey, PaneState> = {main: loadingPane, before: loadingPane, after: loadingPane}

/** A projection's state before anything happened, playback paused at `position`. */
export function initialState(options: ProjectionOptions, position: number): ProjectionState {
  return {
    subject: options.subject,
    settings: initialSettings(options),
    panes: loadingPanes,
    interaction: initialInteraction,
    declaredModes: {},
    seeded: unseeded,
    action: undefined,
    media: noMedia,
    playback: {kind: 'paused', position, direction: options.direction ?? 1, travelled: false, armed: null, stopping: false},
  }
}

/** What the core does for the controller's actions; the same functions for the projection's lifetime. */
export interface ProjectionPrimitives {
  request: RequestChange
  /** Changes the core's own settings directly. */
  setSettings(change: (settings: Settings) => Settings): void
  interact(event: InteractionEvent): void
  runAction(id: string): void
  /** The latest options, for callbacks. */
  latest(): ProjectionOptions
  /** Runs an action: its writes and the handlers it calls reach listeners as one change. */
  batched<T>(act: () => T): T
  playback(): PlaybackController
  frames: {current: Record<Side, RendererFrame | null>}
  stage: StageHandlers
}

/** What the core reconciles and reports after a read is shown. */
export interface ShownView {
  comparing: boolean
  subject: ViewSubject
  mode: ComparisonMode
  chosenMode: ComparisonMode | undefined
  modesKnown: boolean
  renderer: ProjectionController['renderer']
  paneKeys: PaneKey[]
  reducedMotion: boolean
  timing: PlaybackPosition
  plan: PlaybackRun
  playing: boolean
  /** Paused, with no play or stop waiting on the embedder. */
  still: boolean
  selectedId: string | null
  selection: ProjectionSelection | null
  status: RendererStatus
  paint: PaintState
  selectFrom(pane: PaneKey, id: string | null, path?: string): void
  activateAnnotation(rowId: string): void
}

/** One read: the state it used (settled), the controller and what the core reconciles once it is shown. */
export interface Read {
  readonly options: ProjectionOptions
  readonly state: ProjectionState
  readonly controller: ProjectionController
  readonly view: ShownView
}

/** The settings, renderer, modes and playback position a state and options give. */
function createBasics() {
  const memos = createMemos()
  const modesOf = createComparisonModes(memos)
  const positionOf = createPlaybackPosition(memos)
  const read = (state: ProjectionState, options: ProjectionOptions) => {
    const comparing = options.subject.mode === 'comparison'
    const value: ValueOf = key => settingValue(state.settings, options, key)
    const holds: Holds = value('holds') === 'pause' ? 'pause' : 'timeline'
    const speed = speedRange(value('speed'))
    const chosenMode = value('mode') as ComparisonMode | undefined
    const renderers = options.renderers ?? []
    const rendererName = value('rendererName')
    const renderer = renderers.find(entry => entry.name === rendererName) ?? renderers[0]
    const modes = modesOf({comparing, renderer, chosenMode, declaredModes: state.declaredModes})
    const timing = positionOf({
      options,
      comparing,
      mode: modes.mode,
      panes: state.panes,
      holds,
      speed,
      internalPosition: state.settings.position,
    })
    return {comparing, value, holds, speed, chosenMode, renderers, renderer, ...modes, timing}
  }
  return {read, commit: memos.commit}
}

/**
 * The state a read of `options` implies, before anything is derived from it: a new subject restarts the settings and
 * the interaction; a renderer's newly declared controls take the definition's defaults. The same state when neither.
 */
function settled(state: ProjectionState, options: ProjectionOptions, basics: ReturnType<typeof createBasics>): ProjectionState {
  let next = state
  if (options.subject !== state.subject) {
    const {toPosition} = basics.read(state, options).timing
    next = {
      ...next,
      subject: options.subject,
      settings: restartedSettings(next.settings, options, toPosition),
      interaction: initialInteraction,
    }
  }
  const {renderer, paneKeys} = basics.read(next, options)
  const seeding = seedControls(next.seeded, next.panes[paneKeys[0]!].controls, options.presentation, renderer)
  if (seeding) {
    next = {
      ...next,
      seeded: seeding.seeded,
      settings: {...next.settings, controlValues: {...seeding.values, ...next.settings.controlValues}},
    }
  }
  return next
}

/** The controller with each of its functions run as one change (see `ProjectionPrimitives.batched`). */
function batchActions(controller: ProjectionController, batched: ProjectionPrimitives['batched']): ProjectionController {
  const fields: Record<string, unknown> = {...controller}
  for (const [key, field] of Object.entries(fields)) {
    if (typeof field === 'function') {
      fields[key] = (...args: unknown[]) => batched(() => (field as (...args: unknown[]) => unknown)(...args))
    }
  }
  return fields as unknown as ProjectionController
}

/** Reads controllers for a projection whose actions go to `primitives`. */
export function createDerive(primitives: ProjectionPrimitives) {
  const {request, interact, latest, playback} = primitives
  const memos = createMemos()
  const {memo, byValue} = memos
  const basics = createBasics()
  const environmentOf = createHostEnvironment(memos)
  const rowFilter = createRowFilter()
  const payloadsOf = createRendererPayloads()
  const valuesOf = createControlValues(memos)
  const stageOf = createStageBinding(memos, primitives.stage)
  const rowsOf = memo(subjectRows)
  const variationOf = byValue<Variation | undefined>()
  const variationFor = memo(subjectVariation)
  const placedOf = memo(
    (subject: ViewSubject, rows: ReturnType<typeof subjectRows>, annotations: readonly TargetAnnotation[] | undefined) =>
      placeAnnotations(subject, rows, annotations ?? []),
  )
  const marksOf = byValue<AnnotationMark[]>()
  const summaryItemsOf = byValue<SummaryItem[] | undefined>()
  const summaryOf = memo((subject: ViewSubject, items: SummaryItem[] | undefined) => summaryFigures(subject, items))
  const selectionFor = memo(selectionOf)
  const pathsOf = memo(selectedPaths)

  function read(base: ProjectionState, options: ProjectionOptions): Read {
    const state = settled(base, options, basics)
    const {settings, panes, interaction} = state
    const {subject, projection} = options
    const {comparing, value, holds, speed, chosenMode, renderers, renderer, availableModes, modesKnown, mode, paneKeys, timing} =
      basics.read(state, options)
    const {colorMode, theme, reducedMotion} = environmentOf(options, state.media)
    const playing = comparing && value('playing')
    const loop = value('loop')
    const highlighting = value('highlighting')
    const filters = filterState(comparing, value)
    const selectedId = value('selectedId')
    const {position, progress, toPosition, nextStep, previousStep} = timing
    const plan: PlaybackRun = {
      stops: timing.stepEnds,
      travelMs: timing.durationMs,
      loop: loop && !reducedMotion,
      stepHoldMs: holdDuration(stepHoldMs, speed),
      endpointHoldMs: holdDuration(endpointHoldMs, speed),
      timeline: timing.timeline,
      speed,
    }
    const lifecycle = state.playback
    const direction = options.direction ?? lifecycle.direction

    const rows = rowsOf(subject)
    const variation = variationOf(variationFor(subject, rows))
    const placed = placedOf(subject, rows, options.annotations)
    const annotationMarks = marksOf(placed.marks)
    const summaryItems = twoPaneMode(mode) ? (panes.after.summary ?? panes.before.summary) : panes.main.summary
    const summary = summaryOf(subject, summaryItemsOf(summaryItems))
    const {visibleRows, filter, counts: scopeCounts, hidden: scopeHidden} = rowFilter(rows, subject, filters, summary)
    const payloads = payloadsOf({options, renderer, mode, progress, direction, highlighting, theme, reducedMotion})
    const paint = paintState({renderer, comparing, mode, progress, panes, stage: payloads})
    const controls = panes[paneKeys[0]!].controls
    const controlValues = valuesOf(controls, options.controlValues, settings.controlValues)
    const status = rendererState(renderer, panes, paneKeys)

    const selection = selectionFor(selectedId, rows, subject, interaction.pinned)
    const selectedPath = pathsOf(selection)
    const selectRow = (id: string | null, target?: ProjectionTarget) => {
      interact({type: 'selected', rowId: id, target})
      request('selectedId', id)
    }
    const resolve = (target: ProjectionTarget) => resolveTarget(subject, rows, target)
    const activateAnnotation = (rowId: string) => {
      selectRow(rowId)
      const row = rows.find(candidate => candidate.id === rowId)
      latest().onAnnotationActivate?.({rowId, targets: row ? rowTargets(row, subject) : [], annotations: placed.byRow.get(rowId) ?? []})
    }
    const seek = (to: number) => playback().seek(to)
    const stage = stageOf(payloads, controlValues, state.action, filter, interaction.anchors, selectedPath, annotationMarks)

    const controller: ProjectionController = {
      subject,
      comparing,
      projection,
      rows,
      visibleRows,
      selectedRow: selectedId === null ? undefined : rows.find(row => row.id === selectedId),
      notices: [...(options.rendererNotice ? [options.rendererNotice] : []), ...(options.notices ?? []), ...state.seeded.notices],
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
      paint,
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
      swipePosition: unit(value('swipePosition')),
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
      connector: value('connector'),
      search: filters.search,
      selectedId,
      selection,
      hoveredId: interaction.hoveredId,
      annotationMarks,
      annotationsFor: rowId => placed.byRow.get(rowId) ?? [],
      unplacedAnnotations: placed.unplaced,
      controls,
      controlValues,
      legend: twoPaneMode(mode) ? (panes.after.legend ?? panes.before.legend) : panes.main.legend,
      seek,
      seekProgress: next => seek(toPosition(unit(next))),
      play: next => playback().play(next),
      pause: () => playback().pause(),
      toggle: next => playback().toggle(next),
      nextDirection: nextDirection({...lifecycle, direction}, reducedMotion),
      togglePlayback: () => playback().togglePlayback(),
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
      select: id => selectRow(id),
      selectTarget: target => {
        const resolution = resolve(target)
        const chosen = targetSelection(target, resolution)
        if (chosen) selectRow(chosen.rowId, chosen.target)
        return resolution
      },
      resolveTarget: resolve,
      activateAnnotation,
      anchorFor: (rowId, side) =>
        anchorOf(interaction.anchors, primitives.frames, selection, rowId === undefined ? selectedId : rowId, side),
      hover: id => interact({type: 'hovered', rowId: id}),
      setRenderer: name => {
        if (renderers.some(entry => entry.name === name)) request('rendererName', name)
      },
      setControl: (id, next) => {
        const control = controls.find(item => item.id === id)
        if (!control || !isControlValue(control, next)) return
        const current = latest()
        if (current.controlValues === undefined) {
          primitives.setSettings(previous => ({...previous, controlValues: {...previous.controlValues, [id]: next}}))
        }
        current.onControlChange?.(id, next)
      },
      runAction: id => {
        if (!controls.some(control => control.id === id && control.type === 'action')) return
        primitives.runAction(id)
        latest().onAction?.(id)
      },
      openSource: (path, line) => latest().onOpen?.(path, line),
      stage,
    }
    const view: ShownView = {
      comparing,
      subject,
      mode,
      chosenMode,
      modesKnown,
      renderer,
      paneKeys,
      reducedMotion,
      timing,
      plan,
      playing,
      still: lifecycle.kind === 'paused' && lifecycle.armed === null && !lifecycle.stopping,
      selectedId,
      selection,
      status: status.status,
      paint,
      selectFrom: (pane, id, path) => selectRow(id, selectedTarget(pane, id, path, rows, subject)),
      activateAnnotation,
    }
    return {options, state, controller: batchActions(controller, primitives.batched), view}
  }

  return {
    read,
    /** The state a read of `options` implies (see `read`), applied to the state as it is now. */
    settle: (state: ProjectionState, options: ProjectionOptions) => settled(state, options, basics),
    /** Keeps what the last read used, as what later reads compare with first. */
    commit() {
      basics.commit()
      memos.commit()
      rowFilter.commit()
      payloadsOf.commit()
    },
  }
}
