import {expect, test} from '@playwright/test'
import {openWorkbench} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'
import {scenarios} from './scenarios.js'

// One test per scenario, so each has its own time and the suite's shards and workers share them.
test('the gallery has every built-in scenario', () => {
  expect(scenarios.length).toBeGreaterThanOrEqual(40)
})

for (const {key} of scenarios) {
  test(`${key} opens in the gallery (fixtures mode) without renderer errors`, async ({page}) => {
    await openWorkbench(page, harnessInspector(), {scenario: key})
    const view = page.locator('.ph')
    await expect(view, key).toHaveAttribute('data-renderer-status', 'ready')
    // Every pane paints; a scenario opens in its renderer's default mode (diff when supported, else side by side).
    for (const pane of await view.locator('.ph-frame-host').all()) await expect(pane, key).toHaveAttribute('data-rendered-progress', /\d/)
    const mode = await view.getAttribute('data-comparison-mode')
    if (mode === 'animated') {
      await expect(view).toHaveAttribute('data-rendered-progress', /\d/)
      await page.getByRole('slider', {name: 'Transition'}).fill('100')
      await expect(view).toHaveAttribute('data-rendered-progress', '1')
    } else if (mode === 'diff') {
      // A diff is one static frame: no transition to move.
      await expect(page.getByRole('slider', {name: 'Transition'})).toHaveCount(0)
    }
    await expect(page.locator('main').getByRole('alert'), `${key} reports no renderer or comparator problem`).toHaveCount(0)
  })
}
