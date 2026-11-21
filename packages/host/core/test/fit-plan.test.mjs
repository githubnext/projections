import {test} from 'node:test'
import assert from 'node:assert/strict'
import {explore} from '@githubnext/projections-machine/testing'
import {chooseFitPlan, toolbarHysteresis} from '../dist/index.js'
import {fitPlanLifecycle} from '../dist/fit-plan/lifecycle.js'

const plans = ['full', 'compact', 'minimal']
const needs = {full: 600, compact: 450, minimal: 300}
const choose = (width, settled, options = {}) =>
  plans[chooseFitPlan({plans, width, settled: plans.indexOf(settled), need: plan => needs[plan], ...options})]

test('resizing around a threshold collapses as soon as a plan stops fitting and expands only with hysteresis to spare', () => {
  assert.equal(toolbarHysteresis, 24)
  assert.equal(choose(700, 'full'), 'full')
  assert.equal(choose(600, 'full'), 'full')
  assert.equal(choose(599, 'full'), 'compact')
  // Widening again, the fuller plan waits for its need and the hysteresis.
  assert.equal(choose(600, 'compact'), 'compact')
  assert.equal(choose(623, 'compact'), 'compact')
  assert.equal(choose(624, 'compact'), 'full')
  assert.equal(choose(449, 'compact'), 'minimal')
  // Too narrow for every plan: the last one.
  assert.equal(choose(100, 'full'), 'minimal')
  // An unmeasured plan is tried before a measured one below it.
  assert.equal(choose(400, 'full', {need: plan => (plan === 'compact' ? undefined : needs[plan])}), 'compact')
})

test('the hysteresis can depend on the transition', () => {
  // As a two-row bar whose first row is sparse returns to one row without hysteresis.
  const rows = [
    {name: 'one row', rows: 1, need: 700},
    {name: 'one row, compact', rows: 1, need: 500},
    {name: 'two rows', rows: 2, need: 400},
    {name: 'two rows, compact', rows: 2, need: 300},
  ]
  const calls = []
  const choice = (width, sparse) =>
    rows[
      chooseFitPlan({
        plans: rows,
        width,
        settled: 2,
        need: plan => plan.need,
        hysteresis: (from, to) => {
          calls.push(`${from.name} → ${to.name}`)
          return sparse && from.rows === 2 && to.rows === 1 ? 0 : 32
        },
      })
    ].name
  assert.equal(choice(510, false), 'two rows')
  assert.equal(choice(532, false), 'one row, compact')
  assert.equal(choice(510, true), 'one row, compact')
  assert.equal(choice(700, true), 'one row')
  assert.ok(calls.includes('two rows → one row') && calls.includes('two rows → one row, compact'))
  // Only fuller plans than the settled one are asked about.
  assert.ok(calls.every(call => call.startsWith('two rows → one row')))
})

test('a growing label replans: its plan stops fitting and a narrower one is tried, then kept with hysteresis', () => {
  // As `useFitPlan` does: measure the plan shown, choose, show the choice, until the choice is the plan shown.
  let label = 100
  const measure = plan => ({full: 400, compact: 250, minimal: 0})[plan] + label + (plan === 'minimal' ? 100 : 0)
  const bar = {width: 520, needs: new Map(), shown: 0, settled: 0}
  const settle = () => {
    for (let tries = 0; tries < plans.length + 1; tries++) {
      bar.needs.set(plans[bar.shown], measure(plans[bar.shown]))
      const target = chooseFitPlan({plans, width: bar.width, settled: bar.settled, need: plan => bar.needs.get(plan)})
      if (target === bar.shown) return plans[(bar.settled = target)]
      bar.shown = target
    }
    throw new Error('did not settle')
  }
  assert.equal(settle(), 'full')
  // The label grows: what was measured no longer holds, and the full plan doesn't fit.
  label = 150
  bar.needs.clear()
  assert.equal(settle(), 'compact')
  // It shrinks back: the full plan fits again, but not with the hysteresis to spare until the bar is wider.
  label = 100
  bar.needs.clear()
  assert.equal(settle(), 'compact')
  bar.width = 524
  assert.equal(settle(), 'full')
})

/** Sends events in order to the bar's lifecycle. */
function run(state, ...events) {
  for (const event of events) state = fitPlanLifecycle.transition(state, event).state
  return state
}
const fresh = {kind: 'planning', plan: 'wide', settled: 'wide', width: 0, run: 0, hand: 'free', frame: false}

test('a press is not replanned away before its click: focus that moves during it replans once it is released', () => {
  const locked = run(fresh, {type: 'resized', width: 800}, {type: 'fitted', plan: 'narrow', locked: true})
  assert.equal(locked.kind, 'settled')
  // As WebKit does, the press moves focus out of the bar: the replan waits for the release.
  const held = run(locked, {type: 'pressed'}, {type: 'moved'})
  assert.equal(held.kind, 'held')
  assert.equal(fitPlanLifecycle.activities(held).length, 0)
  const released = run(held, {type: 'released'})
  assert.equal(released.kind, 'releasing')
  assert.deepEqual(fitPlanLifecycle.activities(released), [{type: 'machine.after', key: 'replan', ms: 0, event: {type: 'replan'}}])
  // Released, it measures again (a new run) with the plan it kept.
  assert.deepEqual(run(released, {type: 'replan'}), {...released, kind: 'planning', run: locked.run + 1})
  // Without a lock, focus moving plans nothing.
  const free = run(fresh, {type: 'fitted', plan: 'wide', locked: false})
  assert.equal(run(free, {type: 'moved'}), free)
})

test('a resize waits for the next frame, and the bar is measured again at its width there', () => {
  const settled = run(fresh, {type: 'resized', width: 800}, {type: 'fitted', plan: 'wide', locked: false})
  const observed = run(settled, {type: 'observed'})
  assert.deepEqual(fitPlanLifecycle.activities(observed), [{type: 'frame', key: 'frame'}])
  assert.equal(run(observed, {type: 'observed'}), observed)
  const {locked: _, ...planned} = settled
  assert.deepEqual(run(observed, {type: 'frame', width: 400}), {...planned, kind: 'planning', width: 400, run: 1, frame: false})
})

test("every state of the bar's lifecycle", () => {
  explore(fitPlanLifecycle, {
    from: fresh,
    events: [
      {type: 'resized', width: 400},
      {type: 'tried', plan: 'narrow'},
      {type: 'fitted', plan: 'wide', locked: true},
      {type: 'fitted', plan: 'narrow', locked: false},
      {type: 'observed'},
      {type: 'frame', width: 800},
      {type: 'moved'},
      {type: 'pressed'},
      {type: 'released'},
    ],
    // The runs count up without bound: a state is the same with any count.
    key: state => JSON.stringify({...state, run: undefined}),
    depth: 8,
    invariants: {
      'a replan waits while a pointer is pressed': state => state.kind !== 'releasing' || state.hand === 'free',
      'a held replan waits for a press': state => state.kind !== 'held' || state.hand === 'pressing',
      'a frame is asked for only after a resize': state =>
        fitPlanLifecycle.activities(state).some(activity => activity.type === 'frame') === state.frame,
    },
    transitions: {
      'a plan changes only by planning': ({from, to}) => from.plan === to.plan || to.kind === 'planning' || to.plan === to.settled,
      'a press never starts a replan': ({event, to, from}) =>
        event.type !== 'pressed' || to.kind !== 'planning' || from.kind === 'planning',
      'measuring again counts a run': ({event, from, to}) => !['frame', 'replan'].includes(event.type) || to.run === from.run + 1,
    },
    complete: true,
  })
})
