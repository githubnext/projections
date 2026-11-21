// The playback controller's lifecycle: paused or playing, the direction it travels in and whether the slider has moved
// since the subject was shown. Actions (play, pause, toggle, seek) and frame ticks are events; what the view shows
// (whether it plays, the slider position, a controlled direction, reduced motion, the mode, the subject) arrives as
// events when it changes. Playing and the position are requests (effects) the core or the embedder applies: an
// embedder may control both, so playing starts when it is shown, and a playback the embedder started is one too.
import {defineMachine, emit} from '@githubnext/projections-machine'
import type {Step} from '@githubnext/projections-machine'
import {advancePlayback, advanceTimeline, startPlayback, timelineDuration} from '../playback.js'
import type {PlaybackPlan, PlaybackState, PlaybackTimeline} from '../playback.js'

/** What playback moves through: the plan, the timeline when holds are on it, and the speed. */
export type PlaybackRun = PlaybackPlan & {readonly timeline: PlaybackTimeline | undefined; readonly speed: number}

interface Course {
  /** The slider position: the one shown, or the one last asked for. */
  readonly position: number
  /** The direction playback goes, or last went. */
  readonly direction: 1 | -1
  /** Whether the slider has moved (playback, a seek or a step) since the subject was shown. */
  readonly travelled: boolean
}

/**
 * Paused, or playing frame by frame from `run`. While paused, a play asked for is `armed` until the view shows it, and a
 * stop asked for is `stopping` until the view stops showing playback.
 */
export type PlaybackLifecycle =
  | (Course & {readonly kind: 'paused'; readonly armed: PlaybackState | null; readonly stopping: boolean})
  | (Course & {readonly kind: 'playing'; readonly run: PlaybackState})

/** What happens to playback. */
export type PlaybackEvent =
  | {readonly type: 'play'; readonly direction: 1 | -1; readonly plan: PlaybackRun; readonly reducedMotion: boolean}
  | {readonly type: 'pause'}
  /** A play button: pauses playback going this way (or any looping playback), else plays this way. */
  | {readonly type: 'toggle'; readonly direction: 1 | -1; readonly plan: PlaybackRun; readonly reducedMotion: boolean}
  /** The one play button: pauses, else plays the way `nextDirection` says. */
  | {readonly type: 'togglePlayback'; readonly plan: PlaybackRun; readonly reducedMotion: boolean}
  | {readonly type: 'seek'; readonly to: number}
  | {readonly type: 'tick'; readonly elapsedMs: number; readonly plan: PlaybackRun}
  /** Whether the view shows playback playing, after every render: a request it doesn't show yet was declined, or waits. */
  | {readonly type: 'playingShown'; readonly playing: boolean; readonly plan: PlaybackRun; readonly reducedMotion: boolean}
  | {readonly type: 'positionShown'; readonly position: number}
  /** An embedder controls the direction, and it isn't the one playback has. */
  | {readonly type: 'directionShown'; readonly direction: 1 | -1}
  | {readonly type: 'motionShown'; readonly reduced: boolean}
  | {readonly type: 'modeChanged'}
  /** A new subject starts over at `position`; playback stops unless the embedder controls it. */
  | {readonly type: 'subjectChanged'; readonly position: number; readonly stops: boolean}

/** The requests playback makes. */
export type PlaybackEffect =
  | {readonly type: 'requestPlaying'; readonly playing: boolean}
  | {readonly type: 'requestPosition'; readonly position: number}

/** Animation frames, while playing. */
export interface PlaybackActivity {
  readonly type: 'frames'
  readonly key: 'frames'
}

const epsilon = 1e-9
const unit = (value: number) => Math.max(0, Math.min(1, value))
const endpoint = (direction: 1 | -1) => (direction === 1 ? 1 : 0)

/** Where playback starts from `at`: on the timeline it travels at once; otherwise a stop it starts on is half held. */
export function beginPlayback(at: number, direction: 1 | -1, plan: PlaybackRun): PlaybackState {
  return plan.timeline ? {progress: at, direction, holdMs: 0} : startPlayback(at, direction, plan)
}

/** The way the one play button plays: forward from the start, backward from the end once anything has travelled. */
export function nextDirection(state: PlaybackLifecycle, reducedMotion: boolean): 1 | -1 {
  if (state.position <= 0) return 1
  if (state.position >= 1) return state.travelled || reducedMotion ? -1 : 1
  return state.direction
}

/** A transition's result. */
type Next = PlaybackLifecycle | Step<PlaybackLifecycle, PlaybackEffect>

/** Whether playback plays, or will once a request is shown, or still shows until a stop is. */
const active = (state: PlaybackLifecycle) => state.kind === 'playing' || state.armed !== null || state.stopping

/** Paused at the same place, with nothing asked for. */
const resting = ({position, direction, travelled}: PlaybackLifecycle) =>
  ({kind: 'paused', position, direction, travelled, armed: null, stopping: false}) as const

/** Stops playback. It asks for it to stop when it plays, or might, and is `stopping` until the view shows that. */
function stop(state: PlaybackLifecycle, ...effects: PlaybackEffect[]): Next {
  if (!active(state)) return emit(resting(state), ...effects)
  return emit({...resting(state), stopping: true}, ...effects, {type: 'requestPlaying', playing: false})
}

/** Moves the slider to `to`, stopping playback; the direction follows the move. */
function seek(state: PlaybackLifecycle, to: number): Next {
  const position = unit(to)
  const direction = position > state.position + epsilon ? 1 : position < state.position - epsilon ? -1 : state.direction
  return stop({...state, position, direction, travelled: true}, {type: 'requestPosition', position})
}

/** Plays `direction`: from the other end when at the one it goes to; under reduced motion, shows that end instead. */
function play(state: PlaybackLifecycle, direction: 1 | -1, plan: PlaybackRun, reducedMotion: boolean): Next {
  if (reducedMotion) return seek({...state, direction}, endpoint(direction))
  const at = direction === 1 && state.position >= 1 ? 0 : direction === -1 && state.position <= 0 ? 1 : state.position
  const moved: PlaybackEffect[] = at === state.position ? [] : [{type: 'requestPosition', position: at}]
  const run = beginPlayback(at, direction, plan)
  if (state.kind === 'playing') return emit({...state, position: at, direction, run}, ...moved)
  const armed = {...state, position: at, direction, armed: run, stopping: false}
  return state.armed ? emit(armed, ...moved) : emit(armed, ...moved, {type: 'requestPlaying', playing: true})
}

/** The view started showing playback: the armed play, or one the embedder started, away from an end it is at. */
function started(state: Extract<PlaybackLifecycle, {kind: 'paused'}>, plan: PlaybackRun, reducedMotion: boolean): Next {
  // Motion is reduced: the end it goes to, at once.
  if (reducedMotion) {
    return emit(
      {...resting(state), stopping: true},
      {type: 'requestPosition', position: endpoint(state.direction)},
      {type: 'requestPlaying', playing: false},
    )
  }
  const {armed} = state
  if (armed && Math.abs(armed.progress - state.position) <= epsilon && armed.direction === state.direction) {
    return {kind: 'playing', position: state.position, direction: state.direction, travelled: true, run: armed} as const
  }
  const direction = state.position <= 0 ? 1 : state.position >= 1 ? -1 : state.direction
  const run = beginPlayback(state.position, direction, plan)
  return {kind: 'playing', position: state.position, direction, travelled: true, run} as const
}

/** One frame: on the timeline the slider moves at a constant rate; otherwise it pauses at each hold. */
function tick(state: Extract<PlaybackLifecycle, {kind: 'playing'}>, elapsedMs: number, plan: PlaybackRun): Next {
  const step = plan.timeline
    ? (({position, ...rest}) => ({...rest, progress: position, holdMs: 0}))(
        advanceTimeline({position: state.position, direction: state.run.direction}, elapsedMs, {
          turnMs: timelineDuration(plan.timeline) / plan.speed,
          loop: plan.loop,
        }),
      )
    : advancePlayback({...state.run, progress: state.position}, elapsedMs, plan)
  const run = {progress: step.progress, direction: step.direction, holdMs: step.holdMs}
  const next = {...state, position: step.progress, direction: step.direction, run}
  const moved: PlaybackEffect = {type: 'requestPosition', position: step.progress}
  return step.stopped ? stop(next, moved) : emit(next, moved)
}

const common = {
  pause: (state: PlaybackLifecycle) => stop(state),
  seek: (state: PlaybackLifecycle, {to}: {to: number}) => seek(state, to),
  play: (state: PlaybackLifecycle, event: {direction: 1 | -1; plan: PlaybackRun; reducedMotion: boolean}) =>
    play(state, event.direction, event.plan, event.reducedMotion),
  toggle: (state: PlaybackLifecycle, event: {direction: 1 | -1; plan: PlaybackRun; reducedMotion: boolean}) =>
    active(state) && (state.direction === event.direction || event.plan.loop)
      ? stop(state)
      : play(state, event.direction, event.plan, event.reducedMotion),
  togglePlayback: (state: PlaybackLifecycle, event: {plan: PlaybackRun; reducedMotion: boolean}) =>
    active(state) ? stop(state) : play(state, nextDirection(state, event.reducedMotion), event.plan, event.reducedMotion),
  positionShown: <S extends PlaybackLifecycle>(state: S, {position}: {position: number}): S =>
    unit(position) === state.position ? state : {...state, position: unit(position)},
  directionShown: <S extends PlaybackLifecycle>(state: S, {direction}: {direction: 1 | -1}): S =>
    direction === state.direction ? state : {...state, direction},
  modeChanged: (state: PlaybackLifecycle) => stop(state),
}

/** The playback controller's lifecycle. */
export const playbackLifecycle = defineMachine<PlaybackLifecycle, PlaybackEvent, PlaybackEffect, PlaybackActivity>()({
  states: {
    paused: {
      on: {
        ...common,
        tick: state => state,
        playingShown: (state, {playing, plan, reducedMotion}) => {
          // Not shown playing: a stop asked for took; a play asked for was declined, so the next one asks again.
          if (!playing) return state.armed || state.stopping ? resting(state) : state
          // Still shown playing after a stop was asked for: it waits for the embedder, and Pause asks again.
          if (state.stopping) return state
          return started(state, plan, reducedMotion)
        },
        // An embedder may start playback while motion is reduced: that is handled as it is shown.
        motionShown: state => state,
        subjectChanged: (state, {position}) => ({...resting(state), position, travelled: false}),
      },
    },
    playing: {
      on: {
        ...common,
        tick: (state, {elapsedMs, plan}) => tick(state, elapsedMs, plan),
        // The embedder stopped it.
        playingShown: (state, {playing}) => (playing ? state : resting(state)),
        motionShown: (state, {reduced}) => (reduced ? stop(state, {type: 'requestPosition', position: endpoint(state.direction)}) : state),
        // Playback the embedder keeps playing goes on travelling through the new subject.
        subjectChanged: (state, {position, stops}) => (stops ? {...resting(state), position, travelled: false} : {...state, position}),
      },
      activities: () => [{type: 'frames', key: 'frames'}],
    },
  },
})
