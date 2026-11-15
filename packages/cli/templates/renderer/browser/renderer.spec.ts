import {expectScenarioToPass, scenarioKeys, test} from '@githubnext/projections/testing'

// The built-in renderer checks, the same as the Inspector's Checks panel: every
// scenario in scenarios.json, presented by dist/ in the real host frame. Keep
// them passing; each failure says what to change. `npm test` builds first.
test.use({projections: {fixtures: 'scenarios.json', renderers: '.'}})

for (const key of scenarioKeys('scenarios.json')) {
  test(`${key}: built-in renderer checks`, async ({page, inspector}) => {
    await expectScenarioToPass(page, inspector, key)
  })
}
