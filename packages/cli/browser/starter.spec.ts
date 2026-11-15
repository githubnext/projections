import {expect, expectScenarioToPass, openStage, scenarioKeys, test} from '@githubnext/projections-renderer-testing/playwright'
import {join} from 'node:path'
import {renderer} from './starter.js'

// The built bundle (dist/), as viewers load it.
test.use({projections: {fixtures: renderer, renderers: join(renderer, 'dist')}})

for (const key of scenarioKeys(renderer)) {
  test(`starter renderer ${key}: built-in renderer checks`, async ({page, inspector}) => {
    await expectScenarioToPass(page, inspector, key)
  })
}

test('the starter renderer states change status in words, only while changes are highlighted', async ({page, inspector}) => {
  const stage = await openStage(page, inspector, {scenario: 'renderer/split', progress: 0})
  const payments = stage.frame.locator('[data-entity-id="service:payments"] [data-change-footer]')
  await expect(payments).toHaveText('')
  await stage.seek(0.9)
  await expect(payments).toContainText('Added')
  await stage.seek(1)
  await expect(payments).toHaveText('')
})
