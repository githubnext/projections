import {test} from 'node:test'
import assert from 'node:assert/strict'
import {after, defineMachine, ignore} from '../dist/index.js'
import {ExplorationError, explore, stableKey} from '../dist/testing.js'

// A counter that should stop at three but, through a deliberate bug, goes to four from the "fast" step.
const counter = defineMachine()({
  states: {
    counting: {
      on: {
        step: state => (state.n >= 3 ? {kind: 'stopped', n: state.n} : {kind: 'counting', n: state.n + 1}),
        fast: state => ({kind: 'counting', n: state.n + 2}),
        rest: ignore,
      },
      activities: state => (state.n === 0 ? [after('nudge', 100, {type: 'step'})] : []),
    },
    stopped: {on: {step: ignore, fast: ignore, rest: () => ({kind: 'counting', n: 0})}},
  },
})

test('explore reports the shortest path to a state that breaks an invariant', () => {
  assert.throws(
    () =>
      explore(counter, {
        from: {kind: 'counting', n: 0},
        events: [{type: 'step'}, {type: 'fast'}],
        invariants: {'at most three': state => state.n <= 3},
      }),
    error =>
      error instanceof ExplorationError &&
      error.check === 'at most three' &&
      error.path.steps.length === 2 &&
      /counting --fast--> counting --fast--> counting/u.test(error.message),
  )
})

test('explore checks every step with transition invariants', () => {
  assert.throws(
    () =>
      explore(counter, {
        from: {kind: 'counting', n: 0},
        events: [{type: 'step'}, {type: 'fast'}],
        transitions: {'one at a time': ({from, to}) => to.n - from.n <= 1},
      }),
    /one at a time fails on "fast" in "counting": counting --fast--> counting/u,
  )
})

test("explore fires the state's timers, and complete fails on a handler no event reaches", () => {
  const only = explore(counter, {from: {kind: 'counting', n: 0}, events: [], complete: {except: ['counting.fast', 'stopped.rest']}})
  assert.deepEqual([...only.taken], ['counting.step'])
  assert.equal(only.states.size, 2)
  assert.throws(
    () => explore(counter, {from: {kind: 'counting', n: 0}, events: [{type: 'step'}], complete: true}),
    /never taken.*counting\.fast, stopped\.rest/u,
  )
  const all = explore(counter, {from: {kind: 'counting', n: 0}, events: [{type: 'step'}, {type: 'fast'}, {type: 'rest'}], complete: true})
  assert.deepEqual(all.untaken, [])
  assert.equal(all.truncated, false)
})

test('the stable key ignores key order and reads Maps and Sets', () => {
  assert.equal(stableKey({b: 1, a: new Set([2, 1])}), stableKey({a: new Set([1, 2]), b: 1}))
  assert.notEqual(stableKey({a: new Map([['x', 1]])}), stableKey({a: new Map([['x', 2]])}))
})

test('a timer fires once while its state keeps listing it, as in an actor', () => {
  const ticking = defineMachine()({
    states: {on: {on: {tick: state => ({kind: 'on', n: state.n + 1})}, activities: () => [after('tick', 1, {type: 'tick'})]}},
  })
  const result = explore(ticking, {from: {kind: 'on', n: 0}, events: [], invariants: {'one tick': state => state.n <= 1}})
  assert.equal(result.states.size, 2)
})
