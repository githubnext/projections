import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chooseFitPlan, toolbarHysteresis} from '../dist/index.js'

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
