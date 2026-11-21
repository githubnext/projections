import {useCallback, useEffect, useLayoutEffect, useMemo, useRef} from 'react'
import {useMachine} from '@githubnext/projections-machine/react'
import {endpointHoldMs, holdDuration, stepHoldMs} from '../playback.js'
import type {ComparisonMode} from '../modes.js'
import {unit} from './controllable.js'
import type {Controllable} from './controllable.js'
import {nextDirection, playbackLifecycle} from './playback-lifecycle.js'
import type {PlaybackRun} from './playback-lifecycle.js'
import type {PlaybackPosition} from './playback-position.js'

/** The plan and reduced motion of the latest render, for an action called after it. */
const now = (current: {current: {plan: PlaybackRun; reducedMotion: boolean}}) => ({
  plan: current.current.plan,
  reducedMotion: current.current.reducedMotion,
})

export type PlaybackControlInput = Pick<Controllable, 'latest' | 'setInternal' | 'request'> &
  Pick<PlaybackPosition, 'position' | 'progress' | 'stepEnds' | 'durationMs' | 'timeline' | 'toProgress' | 'toPosition'> & {
    playing: boolean
    loop: boolean
    speed: number
    reducedMotion: boolean
    mode: ComparisonMode
    /** The subject shown: a new one starts over. */
    subject: unknown
    /** The direction, when the embedder controls it. */
    direction: 1 | -1 | undefined
  }

/**
 * Seeking, playing and pausing, and the frame loop, run by `playbackLifecycle`. The view's values (playing, the
 * position, the mode, reduced motion, the subject) reach the lifecycle as events when they change; its requests for
 * playing and the position go to the core or the embedder, whichever controls them.
 */
export function usePlaybackControl(input: PlaybackControlInput) {
  const {latest, setInternal, request, position, progress, timeline, toProgress, toPosition, playing, reducedMotion, mode, subject} = input
  const plan: PlaybackRun = {
    stops: input.stepEnds,
    travelMs: input.durationMs,
    loop: input.loop && !reducedMotion,
    stepHoldMs: holdDuration(stepHoldMs, input.speed),
    endpointHoldMs: holdDuration(endpointHoldMs, input.speed),
    timeline,
    speed: input.speed,
  }
  const current = useRef({plan, reducedMotion, toProgress})
  current.current = {plan, reducedMotion, toProgress}
  const [state, send, actor] = useMachine(playbackLifecycle, {
    state: {kind: 'paused', position, direction: input.direction ?? 1, travelled: false, armed: null, stopping: false},
    effects: {
      requestPlaying: ({playing: next}) => request('playing', next),
      // A slider position: `onPositionChange`, and `onProgressChange` when the embedder controls progress.
      requestPosition: ({position: next}) => {
        const clamped = unit(next)
        const options = latest.current
        if (options.position === undefined)
          setInternal(previous => (previous.position === clamped ? previous : {...previous, position: clamped}))
        options.onPositionChange?.(clamped)
        if (options.progress !== undefined) options.onProgressChange?.(current.current.toProgress(clamped))
      },
    },
    activities: {
      frames: (_activity, {send: tick, signal}) => {
        let last: number | undefined
        let handle = requestAnimationFrame(function frame(time) {
          if (last !== undefined) tick({type: 'tick', elapsedMs: time - last, plan: current.current.plan})
          if (signal.aborted) return
          last = time
          handle = requestAnimationFrame(frame)
        })
        return () => cancelAnimationFrame(handle)
      },
    },
  })

  // After every render, the lifecycle is reconciled with what the view shows: the subject, the mode and reduced motion
  // when they change; the position, a controlled direction and whether it plays when they differ from the lifecycle's,
  // so a request an embedder declined (or hasn't applied yet) never leaves the two apart.
  const shown = useRef({reducedMotion, mode, subject})
  useLayoutEffect(() => {
    const last = shown.current
    shown.current = {reducedMotion, mode, subject}
    if (last.subject !== subject) send({type: 'subjectChanged', position, stops: latest.current.playing === undefined})
    if (actor.getState().position !== position) send({type: 'positionShown', position})
    if (input.direction !== undefined && actor.getState().direction !== input.direction)
      send({type: 'directionShown', direction: input.direction})
    if (last.mode !== mode) send({type: 'modeChanged'})
    if (last.reducedMotion !== reducedMotion) send({type: 'motionShown', reduced: reducedMotion})
    send({type: 'playingShown', playing, plan: current.current.plan, reducedMotion})
  })

  // Uncontrolled progress reports every change, including resets.
  useEffect(() => {
    if (latest.current.progress === undefined) latest.current.onProgressChange?.(progress)
  }, [progress, latest])
  // A paused slider keeps showing the same progress when the timeline changes, for example when the renderer reports its steps.
  const kept = useRef({progress, timeline})
  const still = state.kind === 'paused' && state.armed === null && !state.stopping
  useEffect(() => {
    const before = kept.current
    kept.current = {progress, timeline}
    if (before.timeline === timeline || !still) return
    if (latest.current.position !== undefined || latest.current.progress !== undefined) return
    if (Math.abs(toProgress(position) - before.progress) > 1e-9)
      setInternal(previous => ({...previous, position: toPosition(before.progress)}))
  }, [timeline, progress, toPosition, toProgress, latest, setInternal, still, position])

  const seek = useCallback((to: number) => send({type: 'seek', to}), [send])
  const play = useCallback((direction: 1 | -1 = 1) => send({type: 'play', direction, ...now(current)}), [send])
  const pause = useCallback(() => send({type: 'pause'}), [send])
  const toggle = useCallback((direction: 1 | -1 = 1) => send({type: 'toggle', direction, ...now(current)}), [send])
  const togglePlayback = useCallback(() => send({type: 'togglePlayback', ...now(current)}), [send])
  const direction = input.direction ?? state.direction
  return useMemo(
    () => ({
      direction,
      nextDirection: nextDirection({...state, direction}, reducedMotion),
      seek,
      play,
      pause,
      toggle,
      togglePlayback,
    }),
    [state, direction, reducedMotion, seek, play, pause, toggle, togglePlayback],
  )
}
