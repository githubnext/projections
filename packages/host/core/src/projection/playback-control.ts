import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {endpointHoldMs, holdDuration, stepHoldMs} from '../playback.js'
import type {ComparisonMode} from '../modes.js'
import {unit} from './controllable.js'
import type {Controllable} from './controllable.js'
import {createPlaybackController} from './playback-controller.js'
import {nextDirection} from './playback-lifecycle.js'
import type {PlaybackRun} from './playback-lifecycle.js'
import type {PlaybackPosition} from './playback-position.js'

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
 * Seeking, playing and pausing, and the frame loop, run by `playbackLifecycle` through `createPlaybackController`. The view's values (playing, the
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
  const current = useRef({plan, reducedMotion, toProgress, request})
  current.current = {plan, reducedMotion, toProgress, request}
  const [controller] = useState(() =>
    createPlaybackController(
      {position, direction: input.direction},
      {
        plan: () => current.current.plan,
        reducedMotion: () => current.current.reducedMotion,
        requestPlaying: next => current.current.request('playing', next),
        // A slider position: `onPositionChange`, and `onProgressChange` when the embedder controls progress.
        requestPosition: next => {
          const clamped = unit(next)
          const options = latest.current
          if (options.position === undefined)
            setInternal(previous => (previous.position === clamped ? previous : {...previous, position: clamped}))
          options.onPositionChange?.(clamped)
          if (options.progress !== undefined) options.onProgressChange?.(current.current.toProgress(clamped))
        },
      },
    ),
  )
  const {actor} = controller
  const [state, setState] = useState(actor.getState)
  // Started before paint, so the frame loop and a state an event changes there render before paint too.
  useLayoutEffect(() => {
    const unsubscribe = actor.subscribe(setState)
    actor.start()
    setState(actor.getState())
    return () => {
      unsubscribe()
      actor.stop()
    }
  }, [actor])

  // After every render, the lifecycle is reconciled with what the view shows.
  useLayoutEffect(() => {
    controller.show({
      subject,
      mode,
      reducedMotion,
      position,
      playing,
      direction: input.direction,
      playingControlled: latest.current.playing !== undefined,
    })
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

  const direction = input.direction ?? state.direction
  return useMemo(
    () => ({
      direction,
      nextDirection: nextDirection({...state, direction}, reducedMotion),
      seek: controller.seek,
      play: controller.play,
      pause: controller.pause,
      toggle: controller.toggle,
      togglePlayback: controller.togglePlayback,
    }),
    [state, direction, reducedMotion, controller],
  )
}
