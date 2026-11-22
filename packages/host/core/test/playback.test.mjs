import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  advancePlayback,
  advanceTimeline,
  defaultDuration,
  endpointHoldMs,
  minimumDurationMs,
  playbackDuration,
  playbackTurn,
  adjacentStop,
  stepStops,
  holdDuration,
  minimumHoldMs,
  presentationProgress,
  progressForKey,
  startPlayback,
  stepDurationMs,
  stepHoldMs,
  timelineDuration,
  timelinePosition,
  timelineStepPositions,
} from '../dist/index.js'

test('the default playback duration scales with the step count', () => {
  assert.equal(stepDurationMs, 1500)
  assert.equal(defaultDuration(4), 6_000)
  assert.equal(defaultDuration(10), 15_000)
})

test('the default playback duration stays between 4.5 and 20 seconds', () => {
  assert.equal(minimumDurationMs, 4_500)
  assert.equal(defaultDuration(0), 4_500)
  assert.equal(defaultDuration(1), 4_500)
  assert.equal(defaultDuration(-4), 4_500)
  assert.equal(defaultDuration(100), 20_000)
})

test("a renderer's declared pace sets the time per step", () => {
  assert.equal(defaultDuration(4, 1800), 7_200)
  assert.equal(defaultDuration(1, 1800), 4_500)
  assert.equal(defaultDuration(20, 1800), 36_000)
  assert.equal(defaultDuration(100, 5000), 60_000)
})

const plan = (overrides = {}) => ({stops: [0.25, 0.5, 1], travelMs: 1000, stepHoldMs: 1200, endpointHoldMs: 600, loop: true, ...overrides})
/** Advances in 10 ms frames, like an animation loop, recording each state. */
function run(start, ms, options) {
  let state = start
  const frames = []
  for (let elapsed = 0; elapsed < ms; elapsed += 10) {
    state = advancePlayback(state, 10, options)
    frames.push(state)
    if (state.stopped) break
  }
  return frames
}

test('holds scale with speed but stay perceptible', () => {
  assert.equal(stepHoldMs, 1200)
  assert.equal(endpointHoldMs, 600)
  assert.equal(holdDuration(1200, 2), 600)
  assert.equal(holdDuration(1200, 0.5), 2400)
  assert.equal(holdDuration(600, 10), minimumHoldMs)
})

test('playback holds at each step end for the step hold', () => {
  const frames = run({progress: 0, direction: 1, holdMs: 0}, 1500, plan({loop: false}))
  // 250 ms to reach 0.25, then 1200 ms there.
  const held = frames.filter(frame => frame.progress === 0.25)
  assert.ok(held.length >= 119 && held.length <= 121, String(held.length))
  assert.ok(frames.at(-1).progress > 0.25)
})

test('without looping playback stops at the endpoint', () => {
  const frames = run({progress: 0.6, direction: 1, holdMs: 0}, 2000, plan({loop: false}))
  const last = frames.at(-1)
  assert.equal(last.stopped, true)
  assert.equal(last.progress, 1)
  assert.ok(frames.length <= 41)
})

test('looping playback holds at an endpoint, then reverses through the steps back to the start', () => {
  const frames = run({progress: 0.6, direction: 1, holdMs: 0}, 6000, plan())
  assert.ok(frames.every(frame => !frame.stopped))
  const atHead = frames.filter(frame => frame.progress === 1)
  assert.ok(atHead.length >= 59 && atHead.length <= 61, `held ${atHead.length} frames at the endpoint`)
  const reversed = frames.findIndex(frame => frame.direction === -1)
  assert.equal(frames[reversed].progress, 1)
  // After reversing it descends, holding at 0.5 and 0.25, and reaches 0, where it turns forward again.
  const after = frames.slice(reversed)
  assert.ok(after.some(frame => frame.progress === 0.5) && after.some(frame => frame.progress === 0.25))
  const back = after.findIndex(frame => frame.progress === 0)
  assert.ok(back > 0)
  assert.ok(after.slice(back).some(frame => frame.direction === 1))
  // Progress never jumps by more than one frame's travel.
  for (let index = 1; index < frames.length; index++) assert.ok(Math.abs(frames[index].progress - frames[index - 1].progress) <= 0.0101)
})

test('starting on a step end lands mid-hold', () => {
  const options = plan({loop: false})
  const start = startPlayback(0.25, 1, options)
  assert.equal(start.holdMs, 600)
  const frames = run(start, 1000, options)
  const held = frames.filter(frame => frame.progress === 0.25)
  assert.ok(held.length >= 59 && held.length <= 61, String(held.length))
  assert.equal(startPlayback(0.3, 1, options).holdMs, 0)
  // An endpoint is a stop only when looping.
  assert.equal(startPlayback(0, 1, options).holdMs, 0)
  assert.equal(startPlayback(0, 1, plan()).holdMs, 300)
})

test('reverse playback holds at step ends on the way down', () => {
  const frames = run({progress: 0.6, direction: -1, holdMs: 0}, 400, plan({loop: false}))
  assert.equal(frames.at(-1).progress, 0.5)
  assert.ok(frames.every(frame => frame.direction === -1))
})

const timeline = (overrides = {}) => ({stops: [0.25, 0.5], travelMs: 4000, stepHoldMs: 1200, endpointHoldMs: 600, ...overrides})

test('a timeline turn is travel, a hold per step end and both endpoint half-holds', () => {
  assert.equal(timelineDuration(timeline()), 4000 + 2 * 1200 + 600)
  // Endpoints and duplicates aren't step ends.
  assert.equal(timelineDuration(timeline({stops: [0, 0.25, 0.25, 0.5, 1]})), 4000 + 2 * 1200 + 600)
})

test('on the timeline, each hold is a stretch of the slider that shows a constant progress', () => {
  const t = timeline()
  const total = timelineDuration(t)
  const at = elapsed => presentationProgress(elapsed / total, t)
  // The first half endpoint hold shows the before revision.
  assert.equal(at(0), 0)
  assert.equal(at(299), 0)
  // Travel to the first step end, proportional to its length: 0.25 × 4000 ms.
  assert.ok(Math.abs(at(300 + 500) - 0.125) < 1e-9)
  // The plateau at 0.25 lasts the step hold.
  for (const elapsed of [1300.01, 1800, 2499]) assert.equal(at(elapsed), 0.25)
  assert.ok(at(2501) > 0.25)
  // The plateau at 0.5, then the last half endpoint hold at 1.
  for (const elapsed of [3500.01, 4100, 4699]) assert.equal(at(elapsed), 0.5)
  for (const elapsed of [total - 299, total]) assert.equal(at(elapsed), 1)
})

test('presentation progress never decreases as the slider moves forward', () => {
  const t = timeline({stops: [0.1, 0.4, 0.45, 0.9]})
  let previous = -1
  for (let index = 0; index <= 1000; index++) {
    const progress = presentationProgress(index / 1000, t)
    assert.ok(progress >= previous, `at ${index / 1000}`)
    previous = progress
  }
})

test('step ends map to the middle of their holds, and positions round trip', () => {
  const t = timeline()
  const total = timelineDuration(t)
  const [first, second] = timelineStepPositions(t)
  assert.ok(Math.abs(first - (300 + 1000 + 600) / total) < 1e-9)
  assert.ok(Math.abs(second - (300 + 2000 + 1200 + 600) / total) < 1e-9)
  assert.equal(presentationProgress(first, t), 0.25)
  assert.equal(timelinePosition(0, t), 0)
  assert.equal(timelinePosition(1, t), 1)
  for (const progress of [0.01, 0.2, 0.3, 0.49, 0.75, 0.99]) {
    assert.ok(Math.abs(presentationProgress(timelinePosition(progress, t), t) - progress) < 1e-9)
  }
})

test('with one step, the only holds are the endpoints', () => {
  const t = timeline({stops: []})
  assert.equal(timelineDuration(t), 4600)
  assert.deepEqual(timelineStepPositions(t), [])
  assert.ok(Math.abs(presentationProgress(0.5, t) - 0.5) < 1e-9)
})

test('the timeline is symmetric: the endpoint holds mirror each other', () => {
  const t = timeline({stops: [0.5]})
  for (const position of [0, 0.03, 0.2, 0.45, 0.5]) {
    assert.ok(Math.abs(presentationProgress(position, t) + presentationProgress(1 - position, t) - 1) < 1e-9, String(position))
  }
})

test('timeline playback moves the slider at a constant rate, never pausing mid-turn', () => {
  let state = {position: 0, direction: 1}
  const positions = []
  for (let frame = 0; frame < 50; frame++) {
    const next = advanceTimeline(state, 10, {turnMs: 1000, loop: false})
    positions.push(next.position)
    state = next
  }
  for (let index = 1; index < positions.length; index++) assert.ok(Math.abs(positions[index] - positions[index - 1] - 0.01) < 1e-9)
})

test('looping timeline playback reflects at the ends and is symmetric', () => {
  let state = {position: 0.9, direction: 1}
  state = advanceTimeline(state, 300, {turnMs: 1000, loop: true})
  assert.equal(state.direction, -1)
  assert.ok(Math.abs(state.position - 0.8) < 1e-9)
  state = advanceTimeline(state, 1000, {turnMs: 1000, loop: true})
  assert.equal(state.direction, 1)
  assert.ok(Math.abs(state.position - 0.2) < 1e-9)
  // A frame without elapsed time doesn't stop playback where it starts.
  assert.equal(advanceTimeline({position: 0, direction: 1}, 0, {turnMs: 1000, loop: false}).stopped, false)
  assert.equal(advanceTimeline({position: 1, direction: -1}, 0, {turnMs: 1000, loop: false}).stopped, false)
  // Without looping it stops at the end.
  assert.deepEqual(advanceTimeline({position: 0.95, direction: 1}, 100, {turnMs: 1000, loop: false}), {
    position: 1,
    direction: 1,
    stopped: true,
  })
})

test('pause holds keep the slider still at each hold, as before', () => {
  // `holds: 'pause'` uses `advancePlayback` on the slider position directly: it holds at a step end for the step hold.
  let state = {progress: 0.2, direction: 1, holdMs: 0}
  const holdPlan = {stops: [0.25], travelMs: 1000, stepHoldMs: 1200, endpointHoldMs: 600, loop: false}
  let held = 0
  for (let frame = 0; frame < 200; frame++) {
    state = advancePlayback(state, 10, holdPlan)
    if (state.progress === 0.25) held++
  }
  assert.ok(held >= 119 && held <= 121, String(held))
})

test('slider keys move the position', () => {
  const controller = {position: 0.5, nextStep: 0.7, previousStep: undefined}
  assert.equal(progressForKey('ArrowRight', controller), 0.51)
  assert.equal(progressForKey('PageUp', controller), 0.7)
  assert.equal(progressForKey('PageDown', controller), 0.4)
  assert.equal(progressForKey('Home', controller), 0)
})

test('playback duration: the host, then the definition, then the renderer pace, then the default', () => {
  assert.equal(playbackDuration({durationMs: 3000, presentationDurationMs: 8000, paceStepMs: 1800, steps: 4}), 3000)
  assert.equal(playbackDuration({presentationDurationMs: 8000, paceStepMs: 1800, steps: 4}), 8000)
  assert.equal(playbackDuration({paceStepMs: 1800, steps: 4}), 7200)
  assert.equal(playbackDuration({steps: 4}), 6000)
  assert.equal(playbackDuration({steps: 1}), 4500)
})

test('holds stay perceptible and compose with the travel on the timeline', () => {
  assert.equal(stepHoldMs, 1200)
  assert.equal(endpointHoldMs, 600)
  const travelMs = playbackDuration({paceStepMs: 1800, steps: 3})
  assert.equal(timelineDuration({stops: [0.3, 0.6], travelMs, stepHoldMs, endpointHoldMs}), 5400 + 2 * 1200 + 600)
})

test('step navigation stops at 0, every step and 1, and is unavailable only at the ends', () => {
  const stops = stepStops([0.2, 0.5, 0.7])
  assert.deepEqual(
    stops.map(stop => stop.position),
    [0, 0.2, 0.5, 0.7, 1],
  )
  // At 0: no previous; next is the first step.
  assert.equal(adjacentStop(stops, 0, -1), undefined)
  assert.equal(adjacentStop(stops, 0, 1), 0.2)
  // Between steps.
  assert.equal(adjacentStop(stops, 0.3, 1), 0.5)
  assert.equal(adjacentStop(stops, 0.3, -1), 0.2)
  // Past the last step, next is the end (79% → 100%).
  assert.equal(adjacentStop(stops, 0.79, 1), 1)
  // Before the first step, previous is the start.
  assert.equal(adjacentStop(stops, 0.1, -1), 0)
  // At 1: no next; previous is the last step.
  assert.equal(adjacentStop(stops, 1, 1), undefined)
  assert.equal(adjacentStop(stops, 1, -1), 0.7)
  // Without steps, the ends are the stops.
  assert.deepEqual(
    stepStops([]).map(stop => stop.position),
    [0, 1],
  )
  assert.equal(adjacentStop(stepStops([]), 0.4, 1), 1)
})

test('on the timeline, a step hold counts as that step', () => {
  const t = timeline({stops: [0.25, 0.5]})
  const stops = stepStops([0.25, 0.5], t)
  const [, first, second] = stops
  assert.ok(first.from < first.position && first.position < first.to)
  // From anywhere inside the first hold, Next goes to the second step and Previous to the start.
  for (const at of [first.from + 1e-4, first.position, first.to - 1e-4]) {
    assert.equal(adjacentStop(stops, at, 1), second.position)
    assert.equal(adjacentStop(stops, at, -1), 0)
  }
  // Inside the after end's half hold (progress already 1), Next still goes to 1.
  const nearEnd = 1 - 100 / timelineDuration(t)
  assert.equal(presentationProgress(nearEnd, t), 1)
  assert.equal(adjacentStop(stops, nearEnd, 1), 1)
})

test('a recorded turn samples the timeline at a constant rate, each hold one frame, and lasts one turn', () => {
  const turnTimeline = {stops: [0.5], travelMs: 1000, stepHoldMs: 400, endpointHoldMs: 200}
  const frameMs = 50
  const forward = playbackTurn(turnTimeline, 1, frameMs)
  const total = forward.reduce((sum, frame) => sum + frame.durationMs, 0)
  assert.ok(Math.abs(total - timelineDuration(turnTimeline)) < 1e-9)
  // Half the endpoint hold at each end, the whole step hold in the middle, to the frame.
  const near = (frame, progress, durationMs) => {
    assert.equal(frame?.progress, progress)
    assert.ok(Math.abs(frame.durationMs - durationMs) <= frameMs, `${frame.durationMs} ms for ${durationMs} ms`)
  }
  near(forward[0], 0, 100)
  near(forward.at(-1), 1, 100)
  near(
    forward.find(frame => frame.progress === 0.5),
    0.5,
    400,
  )
  for (const [index, frame] of forward.entries()) if (index) assert.ok(frame.progress > forward[index - 1].progress)
  // Backward runs from the after end to the before end through the same timeline.
  const backward = playbackTurn(turnTimeline, -1, frameMs)
  near(backward[0], 1, 100)
  near(backward.at(-1), 0, 100)
  for (const [index, frame] of backward.entries()) if (index) assert.ok(frame.progress < backward[index - 1].progress)
})
