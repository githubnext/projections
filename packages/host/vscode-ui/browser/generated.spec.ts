import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {ready, story} from './harness.js'

/**
 * Generated values in the VS Code UI, on the graph renderer's class-summaries scenario: the summary bar's "1 regenerated"
 * toggle, and the hover widget's Generated values in both forms.
 */
const frame = (page: Page) => page.locator('iframe.ph-frame').first().contentFrame()
const card = (page: Page) => page.locator('[data-detail-card]')
const summary = (page: Page) => card(page).locator('.phv-generated[data-generated-path="/data/summary"]')

test.use({viewport: {width: 1280, height: 800}})

for (const theme of ['light-modern', 'dark-modern'] as const)
  test(`${theme}: regenerated items have their own toggle, and the detail card presents generated values`, async ({page}) => {
    await page.goto(story('projection-view--generated-values', theme))
    await ready(page)
    const toggle = page.getByRole('button', {name: '1 regenerated'})
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(toggle.locator('.codicon-sparkle')).toHaveCount(1)

    await frame(page).locator('[data-entity-id="class:Cart"]').first().click()
    await expect(summary(page)).toHaveAttribute('data-generated', 'regenerated')
    await expect(summary(page).locator('[data-generated-mark]')).toHaveText('Generated')
    await expect(summary(page)).toContainText('Regenerated from the same inputs')
    const height = (await summary(page).boundingBox())!.height
    await summary(page).getByRole('button', {name: "Before's wording"}).click()
    await expect(summary(page).locator('[data-active] [data-side="before"]')).toBeVisible()
    expect((await summary(page).boundingBox())!.height).toBe(height)

    await page.keyboard.press('Escape')
    await frame(page).locator('[data-entity-id="class:Orders"]').first().click()
    await expect(summary(page)).toHaveAttribute('data-generated', 'changed')
    await expect(summary(page)).toContainText('Regenerated because the input changed')
    await summary(page).getByRole('button', {name: 'Word diff'}).click()
    await expect(summary(page).locator('[data-word-diff] ins')).toContainText(['sends a confirmation'])
  })
