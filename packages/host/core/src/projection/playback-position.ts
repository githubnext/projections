import {useCallback, useMemo, useRef, useState} from 'react'
import type {ComparisonMode} from '../modes.js'
import type {PaneState} from '../pane.js'
import {
  adjacentStop,
  endpointHoldMs,
  presentationProgress,
  stepHoldMs,
  stepStops,
  timelinePosition,
  timelineStepPositions,
} from '../playback.js'
import type {Holds, PlaybackTimeline} from '../playback.js'
import {unit} from './controllable.js'
import type {PaneKey, ProjectionOptions} from './types.js'
import {playbackDuration} from './timing.js'

export type PlaybackPositionInput = {
  options: ProjectionOptions
  comparing: boolean
  mode: ComparisonMode
  panes: Record<PaneKey, PaneState>
  holds: Holds
  speed: number
  /** The core's own slider position, for when the embedder controls neither position nor progress. */
  internalPosition: number
  reducedMotion: boolean
}

/**
 * The playback timeline (the renderer's steps, the travel time and the holds), the slider position and the
 * presentation progress it shows, and the steps either side of it.
 */
export function usePlaybackPosition({
  options,
  comparing,
  mode,
  panes,
  holds,
  speed,
  internalPosition,
  reducedMotion,
}: PlaybackPositionInput) {
  const {subject} = options
  const [ownDirection, setDirection] = useState<1 | -1>(1)
  const direction = options.direction ?? ownDirection
  /** Whether the slider has moved (playback, a seek or a step) since this subject was shown. */
  const travelled = useRef(false)
  const stepEnds = mode === 'animated' ? panes.main.steps : []
  const stepCount =
    panes.main.stepSlots ?? (panes.main.steps.length || (subject.mode === 'comparison' ? subject.comparison.steps.length : 0))
  const pace = panes.main.capabilities?.pace ?? panes.after.capabilities?.pace ?? panes.before.capabilities?.pace
  const baseDurationMs = playbackDuration({
    durationMs: options.durationMs,
    presentationDurationMs: options.presentation?.durationMs,
    paceStepMs: pace?.stepMs,
    steps: stepCount,
  })
  const durationMs = baseDurationMs / speed
  const stepsKey = stepEnds.join(',')
  const timeline = useMemo<PlaybackTimeline | undefined>(
    () =>
      holds === 'pause'
        ? undefined
        : {stops: stepsKey ? stepsKey.split(',').map(Number) : [], travelMs: baseDurationMs, stepHoldMs, endpointHoldMs},
    [holds, stepsKey, baseDurationMs],
  )
  const toProgress = useCallback((at: number) => (timeline ? presentationProgress(at, timeline) : unit(at)), [timeline])
  const toPosition = useCallback((at: number) => (timeline ? timelinePosition(at, timeline) : unit(at)), [timeline])
  const position = !comparing
    ? 1
    : options.position !== undefined
      ? unit(options.position)
      : // A controlled progress keeps the slider where it is while that position still shows it, for example across a hold.
        options.progress !== undefined
        ? Math.abs(toProgress(internalPosition) - unit(options.progress)) < 1e-9
          ? internalPosition
          : toPosition(unit(options.progress))
        : unit(internalPosition)
  const progress = comparing ? toProgress(position) : 1
  const stepPositions = useMemo(
    () => (timeline ? timelineStepPositions(timeline) : [...stepEnds]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeline, stepsKey],
  )
  // Until anything has travelled, the play button plays forward (from the start); after reaching the end, backward.
  const nextDirection: 1 | -1 = position <= 0 ? 1 : position >= 1 ? (travelled.current || reducedMotion ? -1 : 1) : direction
  // Step navigation stops at both ends too; a step's hold counts as that step.
  const stops = useMemo(
    () => stepStops(mode === 'animated' ? stepEnds : [], timeline),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stepsKey, timeline, mode],
  )
  return {
    direction,
    setDirection,
    travelled,
    stepEnds,
    baseDurationMs,
    durationMs,
    timeline,
    toProgress,
    toPosition,
    position,
    progress,
    stepPositions,
    nextDirection,
    nextStep: comparing ? adjacentStop(stops, position, 1) : undefined,
    previousStep: comparing ? adjacentStop(stops, position, -1) : undefined,
  }
}

export type PlaybackPosition = ReturnType<typeof usePlaybackPosition>
