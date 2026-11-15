import {expect, expectScenarioToPass, openStage, samples, scenarioKeys, test} from '@githubnext/projections/testing'

// One Inspector in fixtures mode per worker, serving this package's bundle (dist/) and scenarios.
test.use({projections: {fixtures: 'scenarios.json', renderers: '.'}})

// The built-in checks for every scenario: neutral endpoints, still holds, per-step highlighting,
// affordances, one legend, no overflow at phone width and the selection round trip.
for (const key of scenarioKeys('scenarios.json')) {
  test(`${key}: built-in renderer checks`, async ({page, inspector}) => {
    await expectScenarioToPass(page, inspector, key)
  })
}

// Your own assertions, at exact painted frames in the real host frame.
test('steps are marked reached as progress passes them, in both directions', async ({page, inspector}) => {
  const stage = await openStage(page, inspector, {scenario: 'minimal/checkout-split', progress: 0})
  const steps = stage.frame.locator('[data-step]')
  await expect(steps).toHaveCount(2)
  await stage.scrub(samples(8, {roundTrip: true}), async progress => {
    const reached = await steps.evaluateAll(items => items.filter(item => (item as HTMLElement).dataset.reached === 'true').length)
    expect(reached, `at ${progress}`).toBe(progress >= 0.75 ? 2 : progress >= 0.25 ? 1 : 0)
  })
  await stage.select('payments')
  await expect(stage.frame.locator('[data-entity-id="payments"].selected')).toHaveCount(1)
})
