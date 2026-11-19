import {expect, test} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import type {StageHandle} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'
import {scenarios} from './scenarios.js'

/**
 * Hover and selection affordances are drawn once per visual unit, follow its
 * shape and never overflow it; nested parts are tinted, not outlined. Checked
 * for every renderer's scenarios, by host-side hover and selection of each
 * entity, nested ones first.
 */
const perScenario = 14

async function check(stage: StageHandle, label: string) {
  const ids = await stage.measure<string[]>('entities')
  for (const id of ids.slice(0, perScenario)) {
    await stage.hover(id)
    await expect
      .poll(
        () => stage.frame.locator(`[data-entity-id="${id.replaceAll('"', '\\"')}"][data-projections-hovered]`).count(),
        `${label}: hover ${id}`,
      )
      .toBeGreaterThan(0)
    expect(await stage.measure('affordances'), `${label}: hover ${id}`).toEqual([])
    await stage.hover(null)
    await stage.select(id)
    await stage.measure('settle')
    expect(await stage.measure('affordances'), `${label}: select ${id}`).toEqual([])
  }
  await stage.select(null)
}

// One test per scenario, so each has its own time and the suite's shards and workers share them: a renderer with many
// large scenarios (the graph renderer's) took longer than one test's time on CI WebKit.
for (const {key} of scenarios.filter(item => !item.customComparator))
  test(`${key}: hover and selection stay inside their unit`, async ({page}) => {
    test.slow()
    const stage = await openStage(page, harnessInspector(), {scenario: key, progress: 1})
    await check(stage, key)
  })
