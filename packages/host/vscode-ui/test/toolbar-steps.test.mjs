import {test} from 'node:test'
import assert from 'node:assert/strict'
import {carryStep, toolbarSteps} from '../dist/layout/steps.js'

const still = toolbarSteps({pickers: true, modes: true, actions: true})
const animated = toolbarSteps({pickers: true, modes: true, playback: true, actions: true})
const form = layout => `${layout.cluster}|${layout.pickers}|${layout.modes}|${layout.moreActions.join(' ')}`

test('playback coming or going keeps row 1 where it settled, with what each form was measured to need', () => {
  // Settled after the pickers, though the centred step was measured to fit within the hysteresis.
  const settled = still.findIndex(layout => layout.cluster === 'start')
  const required = still.map((_, index) => 900 + index)
  const carried = carryStep(still, settled, required, animated)
  assert.equal(form(animated[carried.step]), form(still[settled]))
  assert.equal(animated[carried.step].rows, 2)
  // The centred steps keep the centred step's need, so returning to the centre still needs the hysteresis.
  assert.ok(animated.every((layout, index) => layout.cluster !== 'centre' || carried.required[index] === 900))
  // And back again.
  const back = carryStep(animated, carried.step, carried.required, still)
  assert.equal(back.step, settled)
})

test('without the settled form in the other order, nothing carries', () => {
  const tab = toolbarSteps({pickers: true, modes: true, actions: true, centre: false})
  assert.equal(carryStep(still, 0, [], tab), undefined)
})
