import {useCallback, useRef, useState} from 'react'
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
function initialInternal(options: ProjectionOptions) {
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
    changesOnly: options.initialChangesOnly ?? presentation?.changesOnly ?? false,
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

export type Internal = ReturnType<typeof initialInternal>

/** Reads a value: the embedder's when it controls it, else the core's own. */
export type ValueOf = <K extends keyof Internal & keyof ProjectionOptions>(key: K) => Internal[K]

/** Requests a change: updates internal state when uncontrolled, and always notifies. */
export type RequestChange = <K extends keyof Internal>(key: K, next: Internal[K]) => void

/**
 * Every value the embedder may control (pass it with its `on…Change` handler) or leave to the core (optionally seeded
 * with `initial…`), and `latest`, the options of the latest render for callbacks that outlive it.
 */
export function useControllable(options: ProjectionOptions) {
  const latest = useRef(options)
  latest.current = options
  const [internal, setInternal] = useState(() => initialInternal(options))
  const value: ValueOf = key => (options[key] !== undefined ? options[key] : internal[key]) as Internal[typeof key]
  const request = useCallback<RequestChange>((key, next) => {
    const current = latest.current as Record<string, unknown>
    if (current[key] === undefined) setInternal(previous => (previous[key] === next ? previous : {...previous, [key]: next}))
    const handler = current[`on${key[0]!.toUpperCase()}${key.slice(1)}Change`]
    if (typeof handler === 'function') (handler as (value: unknown) => void)(next)
  }, [])
  return {latest, internal, setInternal, value, request}
}

export type Controllable = ReturnType<typeof useControllable>
