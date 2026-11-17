import {test} from 'node:test'
import assert from 'node:assert/strict'
import {actionCollapseOrder, toolbarPlans} from '../dist/ui/toolbar-layout.js'

const all = {pair: true, modes: true, playback: true, actions: ['filter', 'fullscreen', 'info', 'zoom']}
const show = plan =>
  `${plan.cluster === 'centre' ? 'centre ' : ''}${plan.rows}:${plan.pair}:${plan.mode}:${plan.playback}:${plan.more.join('+') || '-'}`
/** The plans after the leading ones in the fullest forms (`centre` and its two rows after the pickers). */
const ladder = content => toolbarPlans(content).map(show).slice(6)

test('the mode region is first centred in its fullest forms, playback on row 2, then follows the pickers in them', () => {
  assert.deepEqual(toolbarPlans(all).map(show).slice(0, 6), [
    'centre 2:full:icons:full:-',
    'centre 2:full:icons:compact:-',
    'centre 2:full:icons:minimal:-',
    '2:full:icons:full:-',
    '2:full:icons:compact:-',
    '2:full:icons:minimal:-',
  ])
  // No other plan centres it, and without a mode region none does.
  assert.equal(toolbarPlans(all).filter(plan => plan.cluster === 'centre').length, 3)
  assert.equal(toolbarPlans({...all, modes: false}).filter(plan => plan.cluster === 'centre').length, 0)
})

test('then one row is preferred: it collapses in priority order, actions into More one at a time, before a second row', () => {
  const plans = ladder(all)
  const firstTwoRow = plans.findIndex(plan => plan.startsWith('2:'))
  assert.deepEqual(plans.slice(0, firstTwoRow), [
    '1:full:icons:full:-',
    '1:short:icons:full:-',
    '1:short:menu:full:-',
    '1:short:menu:compact:-',
    '1:short:menu:compact:zoom',
    '1:short:menu:compact:zoom+info',
    '1:short:menu:compact:zoom+info+fullscreen',
    '1:short:menu:compact:zoom+info+fullscreen+filter',
    '1:short:menu:minimal:zoom+info+fullscreen+filter',
  ])
  assert.deepEqual(actionCollapseOrder, ['varied', 'zoom', 'info', 'fullscreen', 'filter'])
})

test('the varied count is the first action into More, before zoom', () => {
  const plans = ladder({...all, actions: [...all.actions, 'varied']})
  const firstTwoRow = plans.findIndex(plan => plan.startsWith('2:'))
  assert.deepEqual(plans.slice(3, firstTwoRow), [
    '1:short:menu:compact:-',
    '1:short:menu:compact:varied',
    '1:short:menu:compact:varied+zoom',
    '1:short:menu:compact:varied+zoom+info',
    '1:short:menu:compact:varied+zoom+info+fullscreen',
    '1:short:menu:compact:varied+zoom+info+fullscreen+filter',
    '1:short:menu:minimal:varied+zoom+info+fullscreen+filter',
  ])
})

test('with two rows, row 1 starts again from its most spacious forms, and row 2 plans its own playback form', () => {
  const plans = toolbarPlans(all).map(show)
  const twoRow = plans.filter(plan => plan.startsWith('2:'))
  // Every row-1 form is tried with each playback form before row 1 collapses further.
  assert.deepEqual(twoRow.slice(0, 6), [
    '2:full:icons:full:-',
    '2:full:icons:compact:-',
    '2:full:icons:minimal:-',
    '2:short:icons:full:-',
    '2:short:icons:compact:-',
    '2:short:icons:minimal:-',
  ])
  // Row 1 moves the actions into More one at a time, and merges the pickers last.
  const rowOne = [
    ...new Set(
      twoRow.map(plan =>
        plan
          .split(':')
          .filter((_, index) => index !== 3)
          .join(':'),
      ),
    ),
  ]
  assert.deepEqual(rowOne, [
    '2:full:icons:-',
    '2:short:icons:-',
    '2:short:menu:-',
    '2:short:menu:zoom',
    '2:short:menu:zoom+info',
    '2:short:menu:zoom+info+fullscreen',
    '2:short:menu:zoom+info+fullscreen+filter',
    '2:merged:menu:zoom+info+fullscreen+filter',
  ])
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
  assert.deepEqual(plans, [
    '1:full:labels:full:-',
    '1:full:labels:compact:-',
    '1:full:labels:minimal:-',
    '2:full:labels:full:-',
    '2:full:labels:compact:-',
    '2:full:labels:minimal:-',
  ])
})

test('one row with the pickers merged comes before two rows with them merged, after the other two-row plans', () => {
  const plans = toolbarPlans(all).map(show)
  const merged = plans.filter(plan => plan.includes(':merged:'))
  assert.deepEqual(merged, [
    '1:merged:menu:compact:zoom+info+fullscreen+filter',
    '1:merged:menu:minimal:zoom+info+fullscreen+filter',
    '2:merged:menu:full:zoom+info+fullscreen+filter',
    '2:merged:menu:compact:zoom+info+fullscreen+filter',
    '2:merged:menu:minimal:zoom+info+fullscreen+filter',
  ])
  assert.ok(plans.indexOf(merged[0]) > plans.indexOf('2:short:menu:minimal:zoom+info+fullscreen+filter'))
  assert.equal(plans.at(-1), merged.at(-1))
})
