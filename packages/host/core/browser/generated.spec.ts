import {test, expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'
import {showAs, story} from './harness.js'

/**
 * Generated values (docs/design/generated-values.md), on the graph renderer's class-summaries scenario compared with the
 * model-upgrades comparator: Cart's summary reworded from the same inputs (unchanged), Orders' regenerated because the
 * class changed and Invoices' only because the model changed. The summary bar counts the regenerated item on its own,
 * the renderer leaves it neutral, and the detail card marks every generated value Generated and presents each change
 * in its form, its toggles never moving what follows.
 */
const view = (page: Page) => page.locator('.ph').first()
const frame = (page: Page) => page.locator('iframe.ph-frame').first().contentFrame()
const card = (page: Page) => page.locator('[data-detail-card]')
const summary = (page: Page) => card(page).locator('.ph-generated[data-generated-path="/data/summary"]')
const regenerated = (page: Page) => page.getByRole('button', {name: '1 regenerated'})

async function open(page: Page) {
  await page.goto(story('default-ui-projection-view--generated-values'))
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready', {timeout: 30_000})
}

async function select(page: Page, id: string) {
  await page.keyboard.press('Escape')
  await frame(page).locator(`[data-entity-id="${id}"]`).first().click()
  await expect(summary(page)).toBeVisible()
}

/** What follows a generated value doesn't move when its toggle is pressed. */
async function steady(value: Locator, toggle: Locator) {
  const height = async () => (await value.boundingBox())!.height
  const before = await height()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(await height()).toBe(before)
}

test.use({viewport: {width: 1280, height: 800}})

test('the summary bar counts regenerated items on their own, and its toggle shows only them', async ({page}) => {
  await open(page)
  const bar = page.getByRole('group', {name: 'Summary'})
  await expect(bar.getByRole('button', {name: '1 regenerated'})).toBeVisible()
  await expect(bar.getByRole('button', {name: /varied within tolerance/})).toHaveCount(0)
  await regenerated(page).click()
  await expect(regenerated(page)).toHaveAttribute('aria-pressed', 'true')
  await showAs(page, 'Table')
  await expect(page.locator('.ph-table-view tr[data-row-id]')).toHaveCount(1)
  await expect(page.locator('.ph-table-view tr[data-row-id="class:Cart"]')).toHaveCount(1)
})

test('the renderer leaves an item regenerated from the same inputs neutral, and marks no generated change volatile', async ({page}) => {
  await open(page)
  const cart = frame(page).locator('[data-entity-id="class:Cart"]').first()
  await expect(cart).not.toHaveAttribute('data-change', /./)
  await expect(cart.locator('[data-change-status], [data-varied]')).toHaveCount(0)
  await expect(frame(page).locator('[data-varied="beyond"]')).toHaveCount(0)
})

test("rewording from the same inputs shows After's text, a neutral note and Before's wording one toggle away", async ({page}) => {
  await open(page)
  await select(page, 'class:Cart')
  const value = summary(page)
  await expect(value).toHaveAttribute('data-generated', 'regenerated')
  await expect(value.locator('[data-generated-mark]')).toHaveText('Generated')
  await expect(value).toContainText('Regenerated from the same inputs')
  const after = value.locator('[data-active] [data-side="after"]')
  await expect(after).toHaveText('Cart keeps the items a customer chose, adding and removing them.')
  await expect(value.locator('del, ins')).toHaveCount(0)
  await expect(value.getByRole('button', {name: "Before's wording"})).toBeVisible()
  await steady(value, value.locator('.ph-generated-toggle'))
  await expect(value.getByRole('button', {name: "After's wording"})).toBeVisible()
  await expect(value.locator('[data-active] [data-side="before"]')).toHaveText(
    'Cart holds the items a customer picked and adds or removes them.',
  )
  // Generated values and their bases aren't listed as changed fields.
  await expect(card(page).locator('[data-field="data:summary"], [data-field="data:summaryBasis"]')).toHaveCount(0)
})

test('a changed basis says why and shows both passages, with a word diff one toggle away', async ({page}) => {
  await open(page)
  await select(page, 'class:Orders')
  const value = summary(page)
  await expect(value).toHaveAttribute('data-generated', 'changed')
  await expect(value).toContainText('Regenerated because the input changed')
  await expect(value.locator('[data-side="before"]')).toHaveText('Orders places an order and records it.')
  await expect(value.locator('[data-side="after"]')).toHaveText('Orders places an order, records it and sends a confirmation.')
  await steady(value, value.getByRole('button', {name: 'Word diff'}))
  await expect(value.locator('[data-word-diff] ins')).toContainText(['sends a confirmation'])

  await select(page, 'class:Invoices')
  await expect(summary(page)).toContainText('the model (fake-summarizer@1 → fake-summarizer@2) changed')
  expect(
    await summary(page)
      .locator('.ph-generated-why code')
      .first()
      .evaluate(element => getComputedStyle(element).fontFamily),
  ).toMatch(/mono/i)
})
