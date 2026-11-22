// The projection store: the state `derive` reads controllers from, the playback actor, the person's preferences, and the
// two phases that follow a read being shown. `commit` keeps what the read used and reconciles playback with it (before
// paint); `report` records what renderers declared and tells the embedder what changed (after paint).
// `createProjection` (`create-projection.ts`) runs them after every change; `useProjection` in React's effects.
import type {RendererFrame} from '../frame.js'
import type {Side} from '../modes.js'
import type {PaneState} from '../pane.js'
import type {RequestChange} from './controllable.js'
import {unit} from './controllable.js'
import {createDerive, initialState} from './derive.js'
import type {ProjectionState, Read} from './derive.js'
import {watchMedia} from './environment.js'
import {interaction} from './interaction.js'
import type {InteractionEvent} from './interaction.js'
import {createStatusEvents} from './paint.js'
import {createPlaybackController} from './playback-controller.js'
import type {FrameScheduler} from './playback-controller.js'
import {declaredModesWith} from './renderer-state.js'
import {createSelectionReport} from './selection.js'
import {notifySetting, requestedSettings} from './settings-store.js'
import type {Settings} from './settings-store.js'
import type {StageHandlers} from './stage-binding.js'
import type {PaneKey, ProjectionOptions} from './types.js'

/** The phases of a projection, for an adapter that runs them when its framework shows a read. */
export interface ProjectionPhases {
  /** The controller for `options` and the state now, and what it used: pure, so it may be discarded. */
  read(options: ProjectionOptions): Read
  /** A read is shown: keep what it used, and reconcile playback with it. */
  commit(read: Read): void
  /** After it is shown: record what the renderers declared, and tell the embedder what changed. */
  report(): void
  /** Counts the state's changes: a new number means a new read. */
  version(): number
  subscribe(listener: () => void): () => void
  /** Starts playback's frames and watching the person's preferences. Construction starts nothing. */
  start(): void
  /** Whether it is started. */
  readonly running: boolean
  stop(): void
}

/** The phases of a projection whose first options are `initial`; `frames` schedules playback's animation frames. */
export function projectionPhases(initial: ProjectionOptions, frames?: FrameScheduler): ProjectionPhases {
  let latest = initial
  let version = 0
  const listeners = new Set<() => void>()
  let state: ProjectionState = initialState(initial, 1)
  // An action's writes and the handlers it calls are one change: listeners hear of it once, when the action is done.
  const batch = {depth: 0, changed: false}
  const notify = () => {
    if (batch.depth) batch.changed = true
    else for (const listener of Array.from(listeners)) listener()
  }
  const batched = <T>(act: () => T): T => {
    batch.depth++
    try {
      return act()
    } finally {
      batch.depth--
      if (!batch.depth && batch.changed) {
        batch.changed = false
        notify()
      }
    }
  }
  const set = (change: (state: ProjectionState) => ProjectionState) => {
    const next = change(state)
    if (next === state) return
    state = next
    version++
    notify()
  }
  const request: RequestChange = (key, next) => {
    const options = latest
    set(current => {
      const settings = requestedSettings(current.settings, options, key, next)
      return settings === current.settings ? current : {...current, settings}
    })
    notifySetting(options, key, next)
  }
  const setSettings = (change: (settings: Settings) => Settings) =>
    set(current => {
      const settings = change(current.settings)
      return settings === current.settings ? current : {...current, settings}
    })
  const interact = (event: InteractionEvent) =>
    set(current => {
      const next = interaction(current.interaction, event)
      return next === current.interaction ? current : {...current, interaction: next}
    })
  const setPane = (key: PaneKey) => (pane: PaneState) =>
    set(current => (current.panes[key] === pane ? current : {...current, panes: {...current.panes, [key]: pane}}))
  const renderers: {current: Record<Side, RendererFrame | null>} = {current: {before: null, after: null}}
  // A side's anchors belong to its frame's renderer: a new frame (or none) reports its own (see `frameReplaced`).
  const replaceFrame = (side: Side) => (frame: RendererFrame | null) => {
    if (renderers.current[side] !== frame) interact({type: 'frameReplaced', side})
    renderers.current[side] = frame
  }
  const stage: StageHandlers = {
    frames: renderers,
    onPaneState: {main: setPane('main'), before: setPane('before'), after: setPane('after')},
    onAnchor: {
      before: (rowId, rect) => interact({type: 'anchored', side: 'before', rowId, rect}),
      after: (rowId, rect) => interact({type: 'anchored', side: 'after', rowId, rect}),
    },
    onFrame: {before: replaceFrame('before'), after: replaceFrame('after')},
    // In swipe, scrolling one layer scrolls the other; the SDK suppresses the echo.
    onViewport: {
      before: position => renderers.current.after?.scroll(position),
      after: position => renderers.current.before?.scroll(position),
    },
    onSelect: {
      main: (id, path) => shown.view.selectFrom('main', id, path),
      before: (id, path) => shown.view.selectFrom('before', id, path),
      after: (id, path) => shown.view.selectFrom('after', id, path),
    },
    onAnnotation: id => shown.view.activateAnnotation(id),
  }
  const derive = createDerive({
    request,
    setSettings,
    interact,
    runAction: id => set(current => ({...current, action: {id, sequence: (current.action?.sequence ?? 0) + 1}})),
    latest: () => latest,
    batched,
    // Called only by actions, once the controller below exists.
    playback: () => controller,
    frames: renderers,
    stage,
  })
  // Playback starts where the first read places the slider.
  const position = derive.read(state, initial).view.timing.position
  state = {...state, playback: {...state.playback, position}}
  /** The read last shown: what actions and playback act on. */
  let shown = derive.read(state, initial)
  const controller = createPlaybackController(
    {position, direction: initial.direction},
    {
      plan: () => shown.view.plan,
      reducedMotion: () => shown.view.reducedMotion,
      requestPlaying: next => request('playing', next),
      // A slider position: `onPositionChange`, and `onProgressChange` when the embedder controls progress.
      requestPosition: next =>
        batched(() => {
          const clamped = unit(next)
          const options = latest
          if (options.position === undefined) {
            setSettings(previous => (previous.position === clamped ? previous : {...previous, position: clamped}))
          }
          options.onPositionChange?.(clamped)
          if (options.progress !== undefined) options.onProgressChange?.(shown.view.timing.toProgress(clamped))
        }),
    },
    frames,
  )
  controller.actor.subscribe(lifecycle => set(current => (current.playback === lifecycle ? current : {...current, playback: lifecycle})))

  const reported: {
    mode?: string
    progress?: {value: number}
    selectedId?: {value: string | null}
    kept?: {progress: number; timeline: unknown}
  } = {}
  const selectionReport = createSelectionReport()
  const statusEvents = createStatusEvents()
  let unwatch: (() => void) | undefined

  return {
    read: options => derive.read(state, options),
    commit(read) {
      latest = read.options
      // The read showed the state it implies; the state may have moved since, so it is settled again, as it is now.
      state = derive.settle(state, read.options)
      shown = read
      derive.commit()
      const {view, options} = read
      controller.show({
        subject: view.subject,
        mode: view.mode,
        reducedMotion: view.reducedMotion,
        position: view.timing.position,
        playing: view.playing,
        direction: options.direction,
        playingControlled: options.playing !== undefined,
      })
    },
    report() {
      const {view, options} = shown
      const {timing} = view
      set(current => {
        const declared = declaredModesWith(current.declaredModes, view.renderer, current.panes[view.paneKeys[0]!].capabilities)
        return declared === current.declaredModes ? current : {...current, declaredModes: declared}
      })
      // A chosen mode the renderer doesn't offer becomes the one shown, once its modes are known.
      const mode = [view.comparing, view.modesKnown, view.chosenMode, view.mode].join(',')
      if (reported.mode !== mode) {
        reported.mode = mode
        if (view.comparing && view.modesKnown && view.chosenMode !== undefined && view.chosenMode !== view.mode) request('mode', view.mode)
      }
      // Uncontrolled progress reports every change, including resets.
      if (reported.progress?.value !== timing.progress) {
        reported.progress = {value: timing.progress}
        if (options.progress === undefined) options.onProgressChange?.(timing.progress)
      }
      // A paused slider keeps showing the same progress when the timeline changes, for example when the renderer
      // reports its steps.
      const kept = reported.kept
      reported.kept = {progress: timing.progress, timeline: timing.timeline}
      if (
        kept &&
        kept.timeline !== timing.timeline &&
        view.still &&
        options.position === undefined &&
        options.progress === undefined &&
        Math.abs(timing.toProgress(timing.position) - kept.progress) > 1e-9
      ) {
        setSettings(previous => ({...previous, position: timing.toPosition(kept.progress)}))
      }
      statusEvents({status: view.status, paint: view.paint, playing: view.playing, mode: view.mode, progress: timing.progress}, options)
      if (reported.selectedId?.value !== view.selectedId) {
        reported.selectedId = {value: view.selectedId}
        if (options.selectedId === undefined) options.onSelectedIdChange?.(view.selectedId)
      }
      const selection = selectionReport(view.selection)
      if (selection !== undefined) options.onSelectionChange?.(selection)
    },
    version: () => version,
    get running() {
      return unwatch !== undefined
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      controller.actor.start()
      if (unwatch) return
      // The first preferences are told before `watchMedia` returns, and a listener may stop the store then.
      const starting = {stopped: false}
      unwatch = () => {
        starting.stopped = true
      }
      const dispose = watchMedia(media =>
        set(current =>
          current.media.prefersDark === media.prefersDark && current.media.reducedMotion === media.reducedMotion
            ? current
            : {...current, media},
        ),
      )
      if (starting.stopped) dispose()
      else unwatch = dispose
    },
    stop() {
      unwatch?.()
      unwatch = undefined
      controller.actor.stop()
    },
  }
}
