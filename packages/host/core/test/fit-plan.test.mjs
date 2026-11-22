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
function run(start, ...events) {
  let state = start
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
  // A frame without a width keeps it: the planning effect measures the bar and sends `resized` if it changed.
  assert.deepEqual(run(observed, {type: 'frame'}), {...planned, kind: 'planning', width: observed.width, run: 1, frame: false})
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
      {type: 'rendered'},
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
      'measuring again counts a run': ({event, from, to, handled}) =>
        !handled || !['frame', 'replan', 'rendered'].includes(event.type) || to.run === from.run + 1,
    },
    complete: true,
  })
})

test('needs carried to new plans by a key, and shifted alike when the shown plan measures differently', async () => {
  const {carryNeeds, shiftNeeds} = await import('../dist/fit-plan/needs.js')
  const sign = plan => plan.id
  const form = plan => plan.form
  const from = [
    {id: 'centre', form: 'centre'},
    {id: 'start', form: 'start'},
    {id: 'start, short', form: 'short'},
  ]
  const to = [
    {id: 'centre, two rows', form: 'centre'},
    {id: 'centre, two rows, overflow', form: 'centre'},
    {id: 'start, two rows', form: 'start'},
    {id: 'merged, two rows', form: 'merged'},
  ]
  const formNeeds = new Map([
    ['centre', 900],
    ['start', 700],
  ])
  // Each new plan takes the need of its form, so returning to the centre still needs the hysteresis.
  const carried = carryNeeds(from, to, from[1], formNeeds, sign, form)
  assert.deepEqual(Object.fromEntries(carried), {
    'centre, two rows': 900,
    'centre, two rows, overflow': 900,
    'start, two rows': 700,
  })
  // Nothing carries when the shown plan's form is gone.
  assert.equal(carryNeeds(from, to, from[2], formNeeds, sign, form), undefined)
  // The shown plan measures 40px more: every known need moves with it.
  shiftNeeds(carried, 'start, two rows', 740)
  assert.deepEqual(Object.fromEntries(carried), {
    'centre, two rows': 940,
    'centre, two rows, overflow': 940,
    'start, two rows': 740,
  })
  // Unknown before, it moves nothing.
  shiftNeeds(carried, 'merged, two rows', 300)
  assert.equal(carried.get('centre, two rows'), 940)
})

test('focus that moves into a control’s own popup is still the control’s: choosing an item may remount it', async () => {
  const {leftOnPurpose} = await import('../dist/fit-plan/focus.js')
  const outside = {}
  const bar = {ownerDocument: {activeElement: outside}, contains: element => element !== outside}
  const control = expanded => ({isConnected: true, getAttribute: name => (name === 'aria-expanded' ? String(expanded) : null)})
  // A menu button whose menu is open, focus in the menu (portalled outside the bar): kept.
  assert.equal(leftOnPurpose(control(true), bar), false)
  // Focus moved elsewhere from a control with nothing open: forgotten.
  assert.equal(leftOnPurpose(control(false), bar), true)
  // Focus still in the bar, or a control that left the document (a remount): kept.
  assert.equal(leftOnPurpose(control(false), {...bar, contains: () => true}), false)
  assert.equal(leftOnPurpose({...control(false), isConnected: false}, bar), false)
  // A custom element whose popup button is in its shadow root (focus is retargeted to the host): kept while it's open.
  const host = expanded => ({isConnected: true, getAttribute: () => null, shadowRoot: {querySelector: () => (expanded ? {} : null)}})
  assert.equal(leftOnPurpose(host(true), bar), false)
  assert.equal(leftOnPurpose(host(false), bar), true)
})

test('a control kept for its open popup is forgotten when the popup closes with focus elsewhere, not when it remounts', async () => {
  const {untilPopupCloses} = await import('../dist/fit-plan/focus.js')
  const settle = () =>
    new Promise(resolve => {
      setTimeout(resolve, 0)
    })
  let notify
  // A stand-in MutationObserver that hands its callback to the test.
  function Observer(callback) {
    notify = callback
    return {
      observe: () => undefined,
      disconnect: () => {
        notify = undefined
      },
    }
  }
  const document = {activeElement: {}}
  const bar = {ownerDocument: document, contains: element => element === 'in-bar'}
  const control = {isConnected: true, expanded: true, getAttribute: name => (name === 'aria-expanded' ? String(control.expanded) : null)}
  // The person pressed elsewhere: the popup closes, focus stays outside the bar.
  let forgotten = 0
  untilPopupCloses(control, bar, () => forgotten++, Observer)
  notify()
  await settle()
  assert.equal(forgotten, 0, 'still open')
  control.expanded = false
  notify()
  await settle()
  assert.equal(forgotten, 1)
  assert.equal(notify, undefined, 'it stops watching')
  // Escape returns focus to the control in the bar as the popup closes: kept.
  control.expanded = true
  untilPopupCloses(control, bar, () => forgotten++, Observer)
  control.expanded = false
  document.activeElement = 'in-bar'
  notify()
  await settle()
  assert.equal(forgotten, 1)
  // Choosing an item remounted the control: kept, for the bar to restore.
  document.activeElement = {}
  control.expanded = true
  untilPopupCloses(control, bar, () => forgotten++, Observer)
  control.isConnected = false
  control.expanded = false
  notify?.()
  await settle()
  assert.equal(forgotten, 1)
})

test('a press and its release change nothing the bar renders, so they never render it again', async () => {
  const {fitPlanView, sameView} = await import('../dist/fit-plan/lifecycle.js')
  // WebKit drops a tap's click when the page renders between its touch and its click.
  let state = {kind: 'settled', plan: 'wide', settled: 'wide', width: 640, run: 3, hand: 'free', frame: false, locked: false}
  const view = fitPlanView(state)
  for (const type of ['pressed', 'released']) {
    state = fitPlanLifecycle.transition(state, {type}).state
    assert.ok(sameView(view, state), `${type} keeps the view`)
  }
  // Nor does holding the plan for a press when focus leaves a locked bar, and releasing it for the replan.
  const locked = {...state, locked: true}
  const held = [{type: 'pressed'}, {type: 'moved'}].reduce((current, event) => fitPlanLifecycle.transition(current, event).state, locked)
  assert.equal(held.kind, 'held')
  assert.ok(sameView(view, held))
  // What the bar shows still renders: another plan tried.
  assert.ok(!sameView(view, fitPlanLifecycle.transition(state, {type: 'tried', plan: 'narrow'}).state))
})
