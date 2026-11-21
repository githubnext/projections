import {test} from 'node:test'
import assert from 'node:assert/strict'
import {comparisonSessionDefaults} from '../dist/index.js'

test('a session starts in Changes with the shared defaults, and no mode until one is chosen', () => {
  assert.deepEqual(comparisonSessionDefaults({}), {
    swipePosition: 0.5,
    highlighting: 'animated',
    changesOnly: true,
    search: '',
    connector: false,
    loop: true,
  })
})

test('the definition’s presentation seeds a session, and a host’s initial values win over it', () => {
  const presentation = {mode: 'side-by-side', highlighting: 'on', changesOnly: false}
  const seeded = comparisonSessionDefaults({presentation})
  assert.equal(seeded.mode, 'side-by-side')
  assert.equal(seeded.highlighting, 'on')
  assert.equal(seeded.changesOnly, false)
  const chosen = comparisonSessionDefaults({presentation, initialMode: 'swipe', initialChangesOnly: true, initialLoop: false})
  assert.equal(chosen.mode, 'swipe')
  assert.equal(chosen.changesOnly, true)
  assert.equal(chosen.loop, false)
})

test('an initial mode the features don’t offer gives way to the first they offer', () => {
  assert.equal(comparisonSessionDefaults({initialMode: 'swipe', features: {modes: ['animated', 'side-by-side']}}).mode, 'side-by-side')
  assert.equal(comparisonSessionDefaults({features: {modes: ['animated']}}).mode, 'animated')
})
