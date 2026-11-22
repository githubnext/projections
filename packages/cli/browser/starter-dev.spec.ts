import {expect, expectScenarioToPass, openStage, scenarioKeys, test} from '@githubnext/projections-renderer-testing/playwright'
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {record, renderer} from './starter.js'

// The package, whose running development server the Inspector prefers to its bundle.
test.use({projections: {fixtures: renderer, renderers: renderer}})

for (const key of scenarioKeys(renderer)) {
  test(`starter renderer ${key} from its development server: built-in renderer checks`, async ({page, inspector}) => {
    await expectScenarioToPass(page, inspector, key)
  })
}

test('an edit updates the renderer in place, keeping the host state', async ({page, inspector}) => {
  const stage = await openStage(page, inspector, {scenario: 'renderer/split', progress: 1})
  expect(page.frames().some(frame => frame.url().startsWith((JSON.parse(readFileSync(record, 'utf8')) as {url: string}).url))).toBe(true)
  const label = stage.frame.locator('[data-entity-id="service:payments"] .pk-entity-card-label')
  await stage.select('service:payments')
  await expect(label).toHaveText('Payments')
  const view = join(renderer, 'src/view.tsx')
  const source = readFileSync(view, 'utf8')
  try {
    writeFileSync(view, source.replace('label={entity.label}', 'label={entity.label.toUpperCase()}'))
    await expect(label).toHaveText('PAYMENTS')
    // Remounted with the host's progress and selection, in the same frame.
    await expect(stage.frame.locator('[data-entity-id="service:payments"].selected')).toHaveCount(1)
    await expect(stage.frame.locator('[data-entity-id="service:billing"]')).toHaveCSS('visibility', 'hidden')
  } finally {
    writeFileSync(view, source)
  }
  await expect(label).toHaveText('Payments')
})
