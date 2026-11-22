// The playback controller's lifecycle (`playbackLifecycle`): requests and their echoes, the one way playback stops at
// an end, playback an embedder starts or declines, and an exploration of every state it reaches.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {explore} from '@githubnext/projections-machine/testing'
import {nextDirection, playbackLifecycle} from '../dist/projection/playback-lifecycle.js'

const plan = {stops: [0.5], travelMs: 1000, stepHoldMs: 0, endpointHoldMs: 0, loop: false, timeline: undefined, speed: 1}
const looping = {...plan, loop: true, endpointHoldMs: 600}
const timeline = {...plan, timeline: {stops: [], travelMs: 1000, stepHoldMs: 0, endpointHoldMs: 0}}
const paused = (position = 0.5, extra = {}) => ({
  kind: 'paused',
  position,
  direction: 1,
  travelled: false,
  armed: null,
  stopping: false,
  ...extra,
})

/** Sends events in order, collecting the effects. */
function run(start, ...events) {
  let state = start
  const effects = []
  for (const event of events) {
    const step = playbackLifecycle.transition(state, event)
    state = step.state
    effects.push(...step.effects)
  }
  return {state, effects}
}

test('play asks for playing once and plays when it is shown; pause asks for it to stop', () => {
  const asked = run(paused(), {type: 'play', direction: 1, plan, reducedMotion: false})
  assert.deepEqual(asked.effects, [{type: 'requestPlaying', playing: true}])
  assert.equal(asked.state.kind, 'paused')
  const playing = run(
    asked.state,
    {type: 'play', direction: 1, plan, reducedMotion: false},
    {type: 'playingShown', playing: true, plan, reducedMotion: false},
  )
  // Asking again while armed doesn't ask the embedder twice.
  assert.deepEqual(playing.effects, [])
  assert.equal(playing.state.kind, 'playing')
  assert.equal(playing.state.travelled, true)
  assert.deepEqual(run(playing.state, {type: 'pause'}).effects, [{type: 'requestPlaying', playing: false}])
})

test('a play the embedder declines is asked for again by the next click, not taken for playback to pause', () => {
  const asked = run(paused(), {type: 'togglePlayback', plan, reducedMotion: false})
  // The embedder ignored it: the next render still shows paused.
  const declined = run(asked.state, {type: 'playingShown', playing: false, plan, reducedMotion: false})
  assert.equal(declined.state.armed, null)
  assert.deepEqual(run(declined.state, {type: 'togglePlayback', plan, reducedMotion: false}).effects, [
    {type: 'requestPlaying', playing: true},
  ])
})

test('playback stops at the end once, from its frames, and the button then plays backward', () => {
  const playing = run(
    paused(0.9),
    {type: 'play', direction: 1, plan, reducedMotion: false},
    {type: 'playingShown', playing: true, plan, reducedMotion: false},
  )
  // The view showing the end doesn't stop it a second time; the frame that reaches it does.
  const shown = run(playing.state, {type: 'positionShown', position: 1})
  assert.deepEqual(shown.effects, [])
  const ended = run(shown.state, {type: 'tick', elapsedMs: 16, plan})
  assert.deepEqual(ended.effects, [
    {type: 'requestPosition', position: 1},
    {type: 'requestPlaying', playing: false},
  ])
  assert.equal(ended.state.kind, 'paused')
  assert.equal(nextDirection(ended.state, false), -1)
  // An embedder that applies the stop a render later still shows playing: playback waits for it rather than playing on.
  const waiting = run(ended.state, {type: 'playingShown', playing: true, plan, reducedMotion: false})
  assert.deepEqual(waiting, {state: ended.state, effects: []})
  const echoed = run(waiting.state, {type: 'playingShown', playing: false, plan, reducedMotion: false})
  assert.deepEqual(echoed, {state: paused(1, {direction: 1, travelled: true}), effects: []})
})

test('a pause the embedder declines leaves playback shown playing, and Pause asks again rather than playing', () => {
  const playing = run(paused(), {type: 'playingShown', playing: true, plan, reducedMotion: false}).state
  const declined = run(playing, {type: 'pause'}, {type: 'playingShown', playing: true, plan, reducedMotion: false})
  assert.deepEqual(declined.effects, [{type: 'requestPlaying', playing: false}])
  assert.deepEqual(run(declined.state, {type: 'togglePlayback', plan, reducedMotion: false}).effects, [
    {type: 'requestPlaying', playing: false},
  ])
})

test('pause then play in one event, shown playing throughout, plays on', () => {
  const playing = run(paused(), {type: 'playingShown', playing: true, plan, reducedMotion: false}).state
  const again = run(
    playing,
    {type: 'pause'},
    {type: 'play', direction: 1, plan, reducedMotion: false},
    {type: 'playingShown', playing: true, plan, reducedMotion: false},
  )
  assert.equal(again.state.kind, 'playing')
})

test('playback an embedder starts at an end goes away from it; under reduced motion it shows the other end at once', () => {
  const started = run(paused(1), {type: 'playingShown', playing: true, plan, reducedMotion: false})
  assert.equal(started.state.kind, 'playing')
  assert.equal(started.state.direction, -1)
  const reduced = run(paused(0), {type: 'playingShown', playing: true, plan, reducedMotion: true})
  assert.deepEqual(reduced.effects, [
    {type: 'requestPosition', position: 1},
    {type: 'requestPlaying', playing: false},
  ])
})

test('a new subject starts over: it stops, and nothing has travelled, unless the embedder plays it', () => {
  const playing = run(paused(), {type: 'playingShown', playing: true, plan, reducedMotion: false}).state
  const stopped = run(playing, {type: 'subjectChanged', position: 1, stops: true})
  assert.deepEqual(stopped.state, paused(1))
  assert.deepEqual(stopped.effects, [])
  const kept = run(playing, {type: 'subjectChanged', position: 1, stops: false})
  assert.equal(kept.state.kind, 'playing')
  assert.equal(kept.state.position, 1)
  assert.equal(nextDirection(stopped.state, false), 1)
})

test('every state playback reaches is consistent, and every request leaves it where it says', () => {
  const plans = [plan, looping, timeline]
  const events = plans.flatMap(each => [
    {type: 'play', direction: 1, plan: each, reducedMotion: false},
    {type: 'play', direction: -1, plan: each, reducedMotion: false},
    {type: 'toggle', direction: 1, plan: each, reducedMotion: false},
    {type: 'togglePlayback', plan: each, reducedMotion: false},
    {type: 'tick', elapsedMs: 400, plan: each},
    {type: 'playingShown', playing: true, plan: each, reducedMotion: false},
  ])
  events.push(
    {type: 'play', direction: 1, plan, reducedMotion: true},
    {type: 'playingShown', playing: true, plan, reducedMotion: true},
    {type: 'playingShown', playing: false, plan, reducedMotion: false},
    {type: 'pause'},
    {type: 'seek', to: 0},
    {type: 'seek', to: 1},
    {type: 'positionShown', position: 0.25},
    {type: 'directionShown', direction: -1},
    {type: 'motionShown', reduced: true},
    {type: 'motionShown', reduced: false},
    {type: 'modeChanged'},
    {type: 'subjectChanged', position: 1, stops: true},
    {type: 'subjectChanged', position: 0, stops: false},
  )
  const asked = (effects, playing) => effects.some(effect => effect.type === 'requestPlaying' && effect.playing === playing)
  const result = explore(playbackLifecycle, {
    from: paused(0),
    events,
    depth: 4,
    key: state => JSON.stringify(state),
    invariants: {
      'the slider is within its range': state => state.position >= 0 && state.position <= 1,
      'playback that plays has travelled': state => state.kind !== 'playing' || state.travelled,
    },
    transitions: {
      'asking to stop leaves it paused and stopping, with nothing armed': ({to, effects}) =>
        !asked(effects, false) || (to.kind === 'paused' && to.armed === null && to.stopping),
      'a stop waiting to be shown never plays again on its own': ({from, event, to}) =>
        from.kind !== 'paused' || !from.stopping || to.kind === 'paused' || ['play', 'toggle', 'togglePlayback'].includes(event.type),
      'asking to play arms a play': ({to, effects}) => !asked(effects, true) || (to.kind === 'paused' && to.armed !== null),
      'a frame that reaches the end it goes to without looping stops': ({from, event, to}) =>
        event.type !== 'tick' ||
        from.kind !== 'playing' ||
        event.plan.loop ||
        to.position !== (from.run.direction === 1 ? 1 : 0) ||
        to.kind === 'paused',
    },
    complete: true,
  })
  assert.equal(result.truncated, false)
})

test('playback that stops at its end has no frames running when it asks the view to stop', async () => {
  const {createActor} = await import('@githubnext/projections-machine')
  const log = []
  let tick
  const actor = createActor(playbackLifecycle, {
    state: {kind: 'playing', position: 0.9, direction: 1, travelled: true, run: {progress: 0.9, direction: 1, holdMs: 0}},
    effects: {
      requestPlaying: ({playing}) => log.push(`playing ${playing}`),
      requestPosition: ({position}) => log.push(`position ${position}`),
    },
    activities: {
      frames: (_, {send, signal}) => {
        tick = () => send({type: 'tick', elapsedMs: 1000, plan})
        log.push('frames')
        signal.addEventListener('abort', () => log.push('frames end'))
      },
    },
  })
  actor.start()
  tick()
  assert.deepEqual(log, ['frames', 'frames end', 'position 1', 'playing false'])
  assert.equal(actor.getState().kind, 'paused')
  actor.stop()
})
