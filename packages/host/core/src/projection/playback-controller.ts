// Playback without a framework: `playbackLifecycle` run by an actor, with the runners it needs (the position and playing
// requests, and a frame loop) and the reconciliation that turns what the view shows into events. `usePlaybackControl`
// runs it in a component; the projection store will run it directly.
import {createActor, type Actor} from '@githubnext/projections-machine'
import type {ComparisonMode} from '../modes.js'
import {playbackLifecycle, type PlaybackEvent, type PlaybackLifecycle, type PlaybackRun} from './playback-lifecycle.js'

/** What playback reads of the host each time it acts, and the requests it makes of it. */
export interface PlaybackHost {
  /** The plan playback runs now: stops, speed, holds, loop. */
  plan(): PlaybackRun
  reducedMotion(): boolean
  /** Playback asks to play or pause: the core's setting, or the embedder's. */
  requestPlaying(playing: boolean): void
  /** Playback asks to move the slider. */
  requestPosition(position: number): void
}

/** Schedules animation frames: `requestAnimationFrame` by default, a fake one in a test. */
export interface FrameScheduler {
  request(callback: (time: number) => void): unknown
  cancel(handle: unknown): void
}

const animationFrames: FrameScheduler = {
  request: callback => requestAnimationFrame(callback),
  cancel: handle => cancelAnimationFrame(handle as number),
}

/** What the view shows of playback after a render, which the lifecycle is reconciled with. */
export interface PlaybackView {
  /** The subject shown: a new one starts over. */
  subject: unknown
  mode: ComparisonMode
  reducedMotion: boolean
  position: number
  playing: boolean
  /** The direction, when the embedder controls it. */
  direction: 1 | -1 | undefined
  /** Whether the embedder controls playing: then a new subject doesn't stop playback. */
  playingControlled: boolean
}

/** Playback's actions and its reconciliation, around one actor. */
export interface PlaybackController {
  readonly actor: Actor<PlaybackLifecycle, PlaybackEvent>
  /**
   * Reconciles the lifecycle with what the view shows now; call it after each render, before paint. The subject, the
   * mode and reduced motion are sent when they change; the position, a controlled direction and whether it plays when
   * they differ from the lifecycle's, so a request an embedder declined (or hasn't applied yet) never leaves the two apart.
   */
  show(view: PlaybackView): void
  seek(to: number): void
  play(direction?: 1 | -1): void
  pause(): void
  toggle(direction?: 1 | -1): void
  togglePlayback(): void
}

/**
 * A playback controller over `playbackLifecycle`, starting paused at `position`. Nothing runs until its actor starts:
 * construction has no side effects, and `actor.start()` and `actor.stop()` may alternate (as in React's development
 * remount).
 */
export function createPlaybackController(
  start: {position: number; direction?: 1 | -1 | undefined},
  host: PlaybackHost,
  frames: FrameScheduler = animationFrames,
): PlaybackController {
  const actor = createActor(playbackLifecycle, {
    state: {kind: 'paused', position: start.position, direction: start.direction ?? 1, travelled: false, armed: null, stopping: false},
    effects: {
      requestPlaying: ({playing}) => host.requestPlaying(playing),
      requestPosition: ({position}) => host.requestPosition(position),
    },
    activities: {
      frames: (_activity, {send, signal}) => {
        let last: number | undefined
        let handle = frames.request(function frame(time) {
          if (last !== undefined) send({type: 'tick', elapsedMs: time - last, plan: host.plan()})
          if (signal.aborted) return
          last = time
          handle = frames.request(frame)
        })
        return () => frames.cancel(handle)
      },
    },
  })
  const now = () => ({plan: host.plan(), reducedMotion: host.reducedMotion()})
  let shown: PlaybackView | undefined
  return {
    actor,
    show(view) {
      const last = shown
      // A copy, so a host that updates one view object and shows it again still has its changes noticed.
      shown = {...view}
      if (last && last.subject !== view.subject) {
        actor.send({type: 'subjectChanged', position: view.position, stops: !view.playingControlled})
      }
      if (actor.getState().position !== view.position) actor.send({type: 'positionShown', position: view.position})
      if (view.direction !== undefined && actor.getState().direction !== view.direction) {
        actor.send({type: 'directionShown', direction: view.direction})
      }
      if (last && last.mode !== view.mode) actor.send({type: 'modeChanged'})
      if (last && last.reducedMotion !== view.reducedMotion) actor.send({type: 'motionShown', reduced: view.reducedMotion})
      actor.send({type: 'playingShown', playing: view.playing, plan: host.plan(), reducedMotion: view.reducedMotion})
    },
    seek: to => actor.send({type: 'seek', to}),
    play: (direction = 1) => actor.send({type: 'play', direction, ...now()}),
    pause: () => actor.send({type: 'pause'}),
    toggle: (direction = 1) => actor.send({type: 'toggle', direction, ...now()}),
    togglePlayback: () => actor.send({type: 'togglePlayback', ...now()}),
  }
}
