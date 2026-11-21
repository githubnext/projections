// The settings an embedder may control, outside React: their initial values, how a value is read and how a change is
// requested. `useControllable` runs it in a component; `createSettingsStore` runs it anywhere.
import type {ControlValue} from '@githubnext/projections-renderer-sdk/protocol'
import type {ComparisonMode} from '../modes.js'
import {endpointHoldMs, stepHoldMs, timelinePosition} from '../playback.js'
import type {Holds, PlaybackTimeline} from '../playback.js'
import type {SummaryFilter} from '../summary.js'
import type {Highlighting, ProjectionOptions} from './types.js'
import {defaultDuration} from './timing.js'

export const speedRange = (speed: number) => (Number.isFinite(speed) ? Math.min(10, Math.max(0.1, speed)) : 1)

export const unit = (value: number) => Math.max(0, Math.min(1, value))

export const positionOn = (progress: number, timeline: PlaybackTimeline | undefined) =>
  timeline ? timelinePosition(progress, timeline) : unit(progress)

/** The timeline before the renderer reports its steps: endpoint holds only. */
function initialTimeline(options: ProjectionOptions): PlaybackTimeline | undefined {
  if (options.holds === 'pause' || (options.holds === undefined && options.initialHolds === 'pause')) return undefined
  const steps = options.subject.mode === 'comparison' ? options.subject.comparison.steps.length : 0
  return {
    stops: [],
    travelMs: Math.max(100, options.durationMs ?? options.presentation?.durationMs ?? defaultDuration(steps)),
    stepHoldMs,
    endpointHoldMs,
  }
}

/** The core's own values, seeded from the `initial…` options, for everything the embedder doesn't control. */
export function initialSettings(options: ProjectionOptions) {
  const {presentation} = options
  return {
    // Before the renderer reports its steps, the timeline has only the endpoint holds.
    position:
      options.subject.mode === 'comparison'
        ? unit(options.initialPosition ?? positionOn(options.initialProgress ?? 1, initialTimeline(options)))
        : 1,
    playing: options.initialPlaying ?? false,
    loop: options.initialLoop ?? true,
    holds: options.initialHolds ?? ('timeline' as Holds),
    speed: speedRange(options.initialSpeed ?? 1),
    mode: options.initialMode ?? (presentation?.mode as ComparisonMode | undefined),
    swipePosition: unit(options.initialSwipePosition ?? 0.5),
    highlighting: options.initialHighlighting ?? presentation?.highlighting ?? ('animated' as Highlighting),
    // A comparison opens on its changes and their context unless the definition opts out.
    changesOnly: options.initialChangesOnly ?? presentation?.changesOnly ?? true,
    variedOnly: options.initialVariedOnly ?? false,
    regeneratedOnly: options.initialRegeneratedOnly ?? false,
    summaryFilter: options.initialSummaryFilter ?? (null as SummaryFilter | null),
    connector: options.initialConnector ?? false,
    search: options.initialSearch ?? '',
    selectedId: options.initialSelectedId ?? (null as string | null),
    rendererName: options.initialRendererName ?? options.renderers?.[0]?.name ?? '',
    controlValues: {} as {[id: string]: ControlValue},
  }
}

/** The core's own values of the settings (`initialSettings`), for those the embedder doesn't control. */
export type Settings = ReturnType<typeof initialSettings>

/** A setting the embedder may control: a value of the options and of the core's own settings. */
export type SettingKey = keyof Settings & keyof ProjectionOptions

/** A setting's value: the embedder's when it controls it, else the core's own. */
export const settingValue = <K extends SettingKey>(settings: Settings, options: ProjectionOptions, key: K): Settings[K] =>
  (options[key] !== undefined ? options[key] : settings[key]) as Settings[K]

/**
 * The core's settings after a requested change: changed only while the embedder doesn't control the setting (and the
 * same object when nothing changes), so a refused change to a controlled one isn't kept for later.
 */
export function requestedSettings<K extends keyof Settings>(
  settings: Settings,
  options: ProjectionOptions,
  key: K,
  next: Settings[K],
): Settings {
  if ((options as Record<string, unknown>)[key] !== undefined || settings[key] === next) return settings
  return {...settings, [key]: next}
}

/** Tells the embedder about a requested change, through the setting's `on…Change`, whether or not it controls it. */
export function notifySetting<K extends keyof Settings>(options: ProjectionOptions, key: K, next: Settings[K]) {
  const handler = (options as Record<string, unknown>)[`on${key[0]!.toUpperCase()}${key.slice(1)}Change`]
  if (typeof handler === 'function') (handler as (value: unknown) => void)(next)
}

/**
 * The core's settings when a new subject replaces the shown one: the slider back where the options start it
 * (`toPosition` maps an initial progress through the current timeline), playback stopped and nothing selected.
 */
export function restartedSettings(settings: Settings, options: ProjectionOptions, toPosition: (progress: number) => number): Settings {
  return {
    ...settings,
    position: options.subject.mode === 'comparison' ? unit(options.initialPosition ?? toPosition(options.initialProgress ?? 1)) : 1,
    playing: false,
    selectedId: options.initialSelectedId ?? null,
  }
}

/** The settings of one projection, run without a framework: read them, request changes and hear about them. */
export interface SettingsStore {
  /** The core's own values; a new object whenever one changes. */
  getSnapshot(): Settings
  /** Calls `listener` after each change; returns the function that stops it. */
  subscribe(listener: () => void): () => void
  /** The embedder's latest options: controlled values, their handlers and the subject. */
  update(options: ProjectionOptions): void
  /** A setting's value: the embedder's when it controls it, else the core's own. */
  value<K extends SettingKey>(key: K): Settings[K]
  /** Requests a change: kept while the setting is uncontrolled, and always reported to its `on…Change`. */
  request<K extends keyof Settings>(key: K, next: Settings[K]): void
  /** Changes the core's own values directly, as the core does when it restarts or records what a renderer declares. */
  set(change: (settings: Settings) => Settings): void
}

/** A `SettingsStore` for a projection's options, seeded from their `initial…` values. */
export function createSettingsStore(initial: ProjectionOptions): SettingsStore {
  let options = initial
  let settings = initialSettings(initial)
  const listeners = new Set<() => void>()
  const set = (change: (settings: Settings) => Settings) => {
    const next = change(settings)
    if (next === settings) return
    settings = next
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => settings,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(next) {
      options = next
    },
    value: key => settingValue(settings, options, key),
    request(key, next) {
      const current = options
      set(previous => requestedSettings(previous, current, key, next))
      notifySetting(current, key, next)
    },
    set,
  }
}
