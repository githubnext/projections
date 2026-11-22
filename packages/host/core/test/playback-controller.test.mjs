// Playback without React (`createPlaybackController`): a host that applies its requests, a frame scheduler stepped by
// hand, and the reconciliation a view runs after each render.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createPlaybackController} from '../dist/projection/playback-controller.js'

const plan = {stops: [0.5], travelMs: 1000, stepHoldMs: 0, endpointHoldMs: 0, loop: false, timeline: undefined, speed: 1}

/** A host that applies every request, as the core does for settings it controls, and a view to show it. */
function setup({position = 0, playingControlled = false} = {}) {
  const view = {subject: 'a', mode: 'animated', reducedMotion: false, position, playing: false, direction: undefined, playingControlled}
  const requests = []
  const queued = new Map()
  let next = 0
  const frames = {
    request: callback => {
      queued.set(++next, callback)
      return next
    },
    cancel: handle => queued.delete(handle),
  }
  const controller = createPlaybackController(
    {position},
    {
      plan: () => plan,
      reducedMotion: () => view.reducedMotion,
      requestPlaying: playing => {
        requests.push({playing})
        view.playing = playing
      },
      requestPosition: to => {
        requests.push({position: to})
        view.position = to
      },
    },
    frames,
  )
  /** Renders: the view's values reach the lifecycle. */
  const render = (change = {}) => {
    Object.assign(view, change)
    return controller.show({...view})
  }
  /** Runs the frames scheduled now at `time`, then renders. */
  const frame = time => {
    const callbacks = [...queued.values()]
    queued.clear()
    for (const callback of callbacks) callback(time)
    render()
  }
  return {controller, view, requests, queued, render, frame}
}

test('nothing runs until the actor starts, and stopping cancels the frame loop', () => {
  const {controller, view, render, queued} = setup()
  controller.play()
  assert.equal(view.playing, false)
  controller.actor.start()
  assert.equal(view.playing, true)
  render()
  assert.equal(controller.actor.getState().kind, 'playing')
  assert.equal(queued.size, 1)
  controller.actor.stop()
  assert.equal(queued.size, 0)
})

test('play runs the frame loop, which moves the slider to the end and stops there', () => {
  const {controller, view, render, frame, requests} = setup()
  controller.actor.start()
  render()
  controller.play()
  render()
  for (let time = 0; time <= 1500 && view.playing; time += 100) frame(time)
  assert.equal(view.position, 1)
  assert.equal(view.playing, false)
  assert.equal(controller.actor.getState().kind, 'paused')
  assert.ok(requests.filter(request => 'position' in request).length > 2)
})

test('pause stops the frame loop where it is; seek moves the slider', () => {
  const {controller, view, render, frame, queued} = setup()
  controller.actor.start()
  render()
  controller.togglePlayback()
  render()
  frame(0)
  frame(200)
  const reached = view.position
  assert.ok(reached > 0 && reached < 1)
  controller.pause()
  render()
  assert.equal(controller.actor.getState().kind, 'paused')
  assert.equal(queued.size, 0)
  assert.equal(view.position, reached)
  controller.seek(0.25)
  render()
  assert.equal(view.position, 0.25)
})

test('a new subject stops playback the core controls, but not playback the embedder controls', () => {
  for (const playingControlled of [false, true]) {
    const {controller, render, frame, queued} = setup({playingControlled})
    controller.actor.start()
    render()
    controller.play()
    render()
    frame(0)
    frame(100)
    // The core restarts its settings for a new subject; an embedder's playing stays as it is.
    render({subject: 'b', position: 0, playing: playingControlled})
    const state = controller.actor.getState()
    assert.equal(state.kind, playingControlled ? 'playing' : 'paused', `controlled: ${playingControlled}`)
    assert.equal(state.position, 0)
    assert.equal(queued.size, playingControlled ? 1 : 0)
  }
})

test('a play the embedder declines leaves playback paused', () => {
  const {controller, render} = setup()
  controller.actor.start()
  render()
  controller.play()
  render({playing: false})
  assert.equal(controller.actor.getState().kind, 'paused')
})

test('a host that shows one view object again, changed, still has the change noticed', () => {
  const {controller, view, queued} = setup()
  controller.actor.start()
  // One object the host updates in place and shows after each change.
  const shown = {...view}
  controller.show(shown)
  controller.play()
  shown.playing = view.playing
  controller.show(shown)
  assert.equal(controller.actor.getState().kind, 'playing')
  shown.reducedMotion = true
  controller.show(shown)
  assert.equal(controller.actor.getState().kind, 'paused')
  assert.equal(queued.size, 0)
})
