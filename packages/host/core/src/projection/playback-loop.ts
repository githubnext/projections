import {useEffect, useRef} from 'react'
import {advancePlayback, advanceTimeline, timelineDuration} from '../playback.js'
import type {ComparisonMode} from '../modes.js'
import type {PlaybackActions} from './playback-actions.js'
import type {PlaybackPosition} from './playback-position.js'

export type PlaybackLoopInput = Pick<
  PlaybackActions,
  'positionRef' | 'playingRef' | 'directionRef' | 'planRef' | 'playback' | 'begin' | 'requestPosition' | 'requestPlaying'
> &
  Pick<PlaybackPosition, 'position' | 'direction' | 'setDirection' | 'travelled'> & {
    playing: boolean
    reducedMotion: boolean
    mode: ComparisonMode
  }

/** Advances playing playback every animation frame, and stops it at its end, when motion is reduced or the mode changes. */
export function usePlaybackLoop(input: PlaybackLoopInput) {
  const {positionRef, playingRef, directionRef, planRef, playback, begin, requestPosition, requestPlaying} = input
  const {playing, reducedMotion, position, direction, setDirection, travelled, mode} = input
  useEffect(() => {
    if (!playing || reducedMotion) return
    // Playback an embedder started (controlled `playing`) begins where the slider is, away from an endpoint it is at.
    if (Math.abs(playback.current.progress - positionRef.current) > 1e-9 || playback.current.direction !== directionRef.current) {
      const at = positionRef.current
      const next: 1 | -1 = at <= 0 ? 1 : at >= 1 ? -1 : directionRef.current
      if (next !== directionRef.current) {
        directionRef.current = next
        setDirection(next)
      }
      playback.current = begin(at, next)
    }
    travelled.current = true
    let handle = 0
    let last: number | undefined
    const tick = (time: number) => {
      if (last !== undefined) {
        const current = planRef.current
        // On the timeline the slider moves at a constant rate and the holds are stretches of it; otherwise the slider pauses.
        const step = current.timeline
          ? (({position: at, ...rest}) => ({...rest, progress: at, holdMs: 0}))(
              advanceTimeline({position: positionRef.current, direction: playback.current.direction}, time - last, {
                turnMs: timelineDuration(current.timeline) / current.speed,
                loop: current.loop,
              }),
            )
          : advancePlayback({...playback.current, progress: positionRef.current}, time - last, current)
        playback.current = {progress: step.progress, direction: step.direction, holdMs: step.holdMs}
        if (step.direction !== directionRef.current) {
          directionRef.current = step.direction
          setDirection(step.direction)
        }
        requestPosition(step.progress)
        if (step.stopped) {
          requestPlaying(false)
          return
        }
      }
      last = time
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, reducedMotion, requestPosition, requestPlaying])
  useEffect(() => {
    // An embedder may start playback while motion is reduced: show the endpoint instead.
    if (!playing || !reducedMotion) return
    requestPosition(direction === 1 ? 1 : 0)
    requestPlaying(false)
  }, [playing, reducedMotion, direction, requestPosition, requestPlaying])
  const loop = planRef.current.loop
  useEffect(() => {
    // The direction playback chose as it started (`directionRef`), which may not have rendered yet.
    if (playing && !loop && position === (directionRef.current === 1 ? 1 : 0)) requestPlaying(false)
  }, [playing, loop, position, direction, requestPlaying, directionRef])
  // Switching modes stops playback, including a loop.
  const playedMode = useRef(mode)
  useEffect(() => {
    if (playedMode.current === mode) return
    playedMode.current = mode
    if (playingRef.current) requestPlaying(false)
  }, [mode, requestPlaying, playingRef])
}
