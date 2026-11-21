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
import type {Memos} from './memo.js'
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
}

const stops = (key: string) => (key ? key.split(',').map(Number) : [])

/**
 * The playback timeline (the renderer's steps, the travel time and the holds), the slider position and the
 * presentation progress it shows, and the steps either side of it.
 */
export function createPlaybackPosition({memo}: Memos) {
  const timelineOf = memo((holds: Holds, stepsKey: string, baseDurationMs: number): PlaybackTimeline | undefined =>
    holds === 'pause' ? undefined : {stops: stops(stepsKey), travelMs: baseDurationMs, stepHoldMs, endpointHoldMs},
  )
  const convertersOf = memo((timeline: PlaybackTimeline | undefined) => ({
    toProgress: (at: number) => (timeline ? presentationProgress(at, timeline) : unit(at)),
    toPosition: (at: number) => (timeline ? timelinePosition(at, timeline) : unit(at)),
  }))
  const stepPositionsOf = memo((timeline: PlaybackTimeline | undefined, stepsKey: string) =>
    timeline ? timelineStepPositions(timeline) : stops(stepsKey),
  )
  // Step navigation stops at both ends too; a step's hold counts as that step.
  const stopsOf = memo((stepsKey: string, timeline: PlaybackTimeline | undefined, mode: ComparisonMode) =>
    stepStops(mode === 'animated' ? stops(stepsKey) : [], timeline),
  )
  return ({options, comparing, mode, panes, holds, speed, internalPosition}: PlaybackPositionInput) => {
    const {subject} = options
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
    const stepsKey = stepEnds.join(',')
    const timeline = timelineOf(holds, stepsKey, baseDurationMs)
    const {toProgress, toPosition} = convertersOf(timeline)
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
    const navigation = stopsOf(stepsKey, timeline, mode)
    return {
      stepEnds,
      baseDurationMs,
      durationMs: baseDurationMs / speed,
      timeline,
      toProgress,
      toPosition,
      position,
      progress: comparing ? toProgress(position) : 1,
      stepPositions: stepPositionsOf(timeline, stepsKey),
      nextStep: comparing ? adjacentStop(navigation, position, 1) : undefined,
      previousStep: comparing ? adjacentStop(navigation, position, -1) : undefined,
    }
  }
}

export type PlaybackPosition = ReturnType<ReturnType<typeof createPlaybackPosition>>
