import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {story} from './harness.js'

const pane = (page: Page, side: 'before' | 'after') => page.locator(`[data-side="${side}"] iframe.ph-frame`).contentFrame()

test('a core-only host shows side by side with its own controls and no playback', async ({page}) => {
  await page.goto(story('harness-default-ui--core-only'))
  await expect(page.getByLabel('Custom status')).toHaveText('ready')
  await expect(page.locator('iframe.ph-frame')).toHaveCount(2)
  await expect(page.getByRole('region', {name: 'Before revision: Base'})).toBeVisible()
  await expect(page.getByRole('region', {name: 'After revision: Head'})).toBeVisible()
  // The core renders no controls of its own.
  await expect(page.getByRole('slider', {name: 'Transition'})).toHaveCount(0)
  await expect(page.getByRole('radiogroup')).toHaveCount(0)
  await expect(page.getByRole('tablist')).toHaveCount(0)
  // Selection, highlighting and the connector come from the core.
  await pane(page, 'before').locator('[data-entity-id="payments"]').first().click()
  await expect(page.getByLabel('Custom selection')).toHaveText('Payments')
  await expect(pane(page, 'after').locator('[data-entity-id="payments"]').first()).toHaveClass(/selected/u)
  await expect(page.locator('.ph-panes')).not.toHaveAttribute('data-connector', 'none')
  await expect(pane(page, 'before').locator('.pk')).toHaveAttribute('data-highlighting', '1')
  // The custom find field filters through the protocol: non-matching entities are marked in the frames.
  await page.getByLabel('Find').fill('pay')
  await expect(pane(page, 'after').locator('[data-entity-id="checkout"]').first()).toHaveAttribute('data-projections-filtered', '')
  await expect(pane(page, 'after').locator('[data-entity-id="payments"]').first()).not.toHaveAttribute('data-projections-filtered')
})

for (const mode of ['animated', 'side-by-side', 'swipe'] as const) {
  test(`a filling stage fits its container's height (${mode})`, async ({page, viewport}) => {
    await page.goto(story('harness-default-ui--core-only', `fill&mode=${mode}`))
    await expect(page.getByLabel('Custom status')).toHaveText('ready')
    const container = (await page.locator('.core-fill').boundingBox())!
    const frames = page.locator('iframe.ph-frame')
    await expect(frames).toHaveCount(mode === 'animated' ? 1 : 2)
    for (const frame of await frames.all()) {
      const box = (await frame.boundingBox())!
      // Frames stay inside the container, whatever height the renderer asks for.
      expect(box.y).toBeGreaterThanOrEqual(container.y - 1)
      expect(box.y + box.height).toBeLessThanOrEqual(container.y + container.height + 1)
      expect(box.height).toBeGreaterThan(mode === 'side-by-side' && (viewport?.width ?? 1000) < 640 ? 120 : 300)
    }
    // The stage and its body fill the container.
    const stage = (await page.locator('.ph-stage').boundingBox())!
    expect(Math.abs(stage.height - (container.height - 2))).toBeLessThanOrEqual(2)
  })
}
