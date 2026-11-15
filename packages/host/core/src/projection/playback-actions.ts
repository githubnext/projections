import {useCallback, useEffect, useRef} from 'react'
import {endpointHoldMs, holdDuration, startPlayback, stepHoldMs} from '../playback.js'
import type {PlaybackPlan, PlaybackState} from '../playback.js'
import {unit} from './controllable.js'
import type {Controllable} from './controllable.js'
import type {PlaybackPosition} from './playback-position.js'

export type PlaybackActionsInput = Pick<Controllable, 'latest' | 'setInternal' | 'request'> &
  Pick<PlaybackPosition, 'position' | 'progress' | 'direction' | 'setDirection' | 'travelled' | 'stepEnds' | 'durationMs' | 'timeline'> &
  Pick<PlaybackPosition, 'toProgress' | 'toPosition'> & {
    playing: boolean
    loop: boolean
    speed: number
    reducedMotion: boolean
  }

/**
 * Seeking, playing and pausing. The playback plan and position live in refs, so the frame loop (`usePlaybackLoop`)
 * keeps running across direction reversals, and playback advances from the latest requested position even before the
 * next render.
 */
export function usePlaybackActions(input: PlaybackActionsInput) {
  const {latest, setInternal, request, position, progress, direction, setDirection, travelled, timeline} = input
  const {toProgress, toPosition, playing, reducedMotion} = input
  const positionRef = useRef(position)
  positionRef.current = position
  const playingRef = useRef(playing)
  playingRef.current = playing

  /** Requests a slider position: notifies `onPositionChange`, and `onProgressChange` when the embedder controls progress. */
  const requestPosition = useCallback(
    (next: number) => {
      const clamped = unit(next)
      positionRef.current = clamped
      const current = latest.current
      if (current.position === undefined)
        setInternal(previous => (previous.position === clamped ? previous : {...previous, position: clamped}))
      current.onPositionChange?.(clamped)
      if (current.progress !== undefined) current.onProgressChange?.(toProgressRef.current(clamped))
    },
    [latest, setInternal],
  )
  const toProgressRef = useRef(toProgress)
  toProgressRef.current = toProgress
  const plan: PlaybackPlan & {timeline: typeof timeline; speed: number} = {
    stops: input.stepEnds,
    travelMs: input.durationMs,
    loop: input.loop && !reducedMotion,
    stepHoldMs: holdDuration(stepHoldMs, input.speed),
    endpointHoldMs: holdDuration(endpointHoldMs, input.speed),
    timeline,
    speed: input.speed,
  }
  const planRef = useRef(plan)
  planRef.current = plan
  // With `holds: 'pause'`, `progress` here is the slider position (they are equal).
  const playback = useRef<PlaybackState>({progress: position, direction: 1, holdMs: 0})
  const begin = (at: number, next: 1 | -1): PlaybackState =>
    planRef.current.timeline ? {progress: at, direction: next, holdMs: 0} : startPlayback(at, next, planRef.current)
  const directionRef = useRef(direction)
  directionRef.current = direction
  const requestPlaying = useCallback(
    (next: boolean) => {
      if (playingRef.current === next && latest.current.playing === undefined) return
      playingRef.current = next
      request('playing', next)
    },
    [latest, request],
  )
  const seek = useCallback(
    (next: number) => {
      requestPlaying(false)
      travelled.current = true
      // Seeking travels too: the play button continues that way.
      const from = positionRef.current
      if (next > from + 1e-9) {
        directionRef.current = 1
        setDirection(1)
      } else if (next < from - 1e-9) {
        directionRef.current = -1
        setDirection(-1)
      }
      requestPosition(next)
    },
    [requestPlaying, requestPosition, setDirection, travelled],
  )
  const play = useCallback(
    (next: 1 | -1 = 1) => {
      setDirection(next)
      if (reducedMotion) {
        seek(next === 1 ? 1 : 0)
        return
      }
      if (next === 1 && positionRef.current >= 1) requestPosition(0)
      if (next === -1 && positionRef.current <= 0) requestPosition(1)
      playback.current = begin(positionRef.current, next)
      directionRef.current = next
      requestPlaying(true)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [reducedMotion, seek, requestPosition, requestPlaying, setDirection],
  )
  const pause = useCallback(() => requestPlaying(false), [requestPlaying])
  const toggle = useCallback(
    (next: 1 | -1 = 1) => {
      // A looping playback reverses by itself, so either play button pauses it.
      if (playingRef.current && (direction === next || planRef.current.loop)) requestPlaying(false)
      else play(next)
    },
    [direction, play, requestPlaying],
  )

  // Uncontrolled progress reports every change, including resets.
  useEffect(() => {
    if (latest.current.progress === undefined) latest.current.onProgressChange?.(progress)
  }, [progress, latest])
  // A paused slider keeps showing the same progress when the timeline changes, for example when the renderer reports its steps.
  const shownProgress = useRef(progress)
  const shownTimeline = useRef(timeline)
  useEffect(() => {
    if (shownTimeline.current !== timeline) {
      shownTimeline.current = timeline
      if (!playingRef.current && latest.current.position === undefined && latest.current.progress === undefined) {
        const kept = toPosition(shownProgress.current)
        if (Math.abs(toProgress(positionRef.current) - shownProgress.current) > 1e-9)
          setInternal(previous => ({...previous, position: kept}))
      }
    }
    shownProgress.current = progress
  }, [timeline, progress, toPosition, toProgress, latest, setInternal])

  return {positionRef, playingRef, directionRef, planRef, playback, begin, requestPosition, requestPlaying, seek, play, pause, toggle}
}

export type PlaybackActions = ReturnType<typeof usePlaybackActions>
