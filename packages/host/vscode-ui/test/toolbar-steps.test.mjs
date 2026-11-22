import {test} from 'node:test'
import assert from 'node:assert/strict'
import {locateStep, rowForm, toolbarSteps} from '../dist/layout/steps.js'

// A host that opts into centring (`centreModes`): the default leads the row with the modes.
const still = toolbarSteps({pickers: true, modes: true, actions: true, centre: true})
const animated = toolbarSteps({pickers: true, modes: true, playback: true, actions: true, centre: true})

test('playback coming or going keeps row 1 where it settled', () => {
  const settled = still.findIndex(layout => layout.cluster === 'start')
  const carried = locateStep(animated, still[settled])
  assert.equal(rowForm(animated[carried]), rowForm(still[settled]))
  assert.equal(animated[carried].rows, 2)
  // And back again.
  assert.equal(locateStep(still, animated[carried]), settled)
  // In its own order a step stays itself, though an earlier one has its row 1 form.
  const overflow = animated.findIndex(layout => layout.cluster === 'start' && layout.playbackOverflow)
  assert.ok(animated.findIndex(layout => rowForm(layout) === rowForm(animated[overflow])) < overflow)
  assert.equal(locateStep(animated, animated[overflow]), overflow)
})

test('without the settled form in the other order, the first step', () => {
  const tab = toolbarSteps({pickers: true, modes: true, actions: true})
  assert.equal(locateStep(tab, still[0]), 0)
})

test('by default the modes are never centred: they lead the row', () => {
  for (const playback of [false, true]) {
    assert.ok(toolbarSteps({pickers: true, modes: true, playback, actions: true}).every(layout => layout.cluster === 'start'))
  }
})
