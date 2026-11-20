import {test} from 'node:test'
import assert from 'node:assert/strict'
import {actionCollapseOrder, toolbarPlans} from '../dist/ui/toolbar-layout.js'

const all = {pair: true, modes: true, playback: true, actions: ['filter', 'fullscreen', 'info', 'zoom']}
const show = plan =>
  `${plan.cluster === 'centre' ? 'centre ' : ''}${plan.rows}:${plan.pair}:${plan.mode}:${plan.playback}:${plan.more.join('+') || '-'}`
/** Row 1's forms in the order tried, without the playback form row 2 takes. */
const rowOne = plans => [
  ...new Set(plans.map(plan => `${plan.cluster === 'centre' ? 'centre ' : ''}${plan.pair}:${plan.mode}:${plan.more.join('+') || '-'}`)),
]

test('with playback every plan has two rows, the mode region first centred in its fullest forms', () => {
  const plans = toolbarPlans(all)
  assert.ok(plans.every(plan => plan.rows === 2))
  assert.deepEqual(plans.slice(0, 6).map(show), [
    'centre 2:full:icons:full:-',
    'centre 2:full:icons:compact:-',
    'centre 2:full:icons:minimal:-',
    '2:full:icons:full:-',
    '2:full:icons:compact:-',
    '2:full:icons:minimal:-',
  ])
  // No other plan centres it, and without a mode region none does.
  assert.equal(plans.filter(plan => plan.cluster === 'centre').length, 3)
  assert.equal(toolbarPlans({...all, modes: false}).filter(plan => plan.cluster === 'centre').length, 0)
})

test('row 1 collapses in priority order, actions into More one at a time, the pickers merged last', () => {
  assert.deepEqual(rowOne(toolbarPlans(all)), [
    'centre full:icons:-',
    'full:icons:-',
    'short:icons:-',
    'short:menu:-',
    'short:menu:zoom',
    'short:menu:zoom+info',
    'short:menu:zoom+info+fullscreen',
    'short:menu:zoom+info+fullscreen+filter',
    'merged:menu:zoom+info+fullscreen+filter',
  ])
  assert.deepEqual(actionCollapseOrder, ['varied', 'zoom', 'info', 'fullscreen', 'filter'])
})

test('the varied count is the first action into More, before zoom', () => {
  const more = rowOne(toolbarPlans({...all, actions: [...all.actions, 'varied']})).filter(form => form.startsWith('short:menu:'))
  assert.deepEqual(more.slice(0, 3), ['short:menu:-', 'short:menu:varied', 'short:menu:varied+zoom'])
})

test('without playback, one row collapses in the same order and ends with the merged pickers', () => {
  const plans = toolbarPlans({...all, playback: false, actions: ['filter', 'info']}).map(show)
  assert.deepEqual(plans, [
    'centre 1:full:icons:full:-',
    '1:full:icons:full:-',
    '1:short:icons:full:-',
    '1:short:menu:full:-',
    '1:short:menu:full:info',
    '1:short:menu:full:info+filter',
    '1:merged:menu:full:info+filter',
  ])
})

test('regions a toolbar lacks drop out of the order', () => {
  const plans = toolbarPlans({pair: false, modes: false, playback: true, actions: []}).map(show)
  assert.deepEqual(plans, ['2:full:labels:full:-', '2:full:labels:compact:-', '2:full:labels:minimal:-'])
})
