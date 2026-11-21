import {test, expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'
import {chooseMode, explorer, showAs} from './harness.js'

/**
 * The detail card (docs/guides/host-ui.md "The detail card"): anchored to the selected item over the stage, it never moves the
 * stage or toolbar, stays in the viewport (a bottom sheet on narrow stages), closes with Escape, a press elsewhere or
 * an empty selection, and its connections and evidence act.
 */
const view = (page: Page) => page.locator('.ph')
const card = (page: Page) => page.locator('[data-detail-card]')
const output = (page: Page, label: string) => page.getByLabel(label, {exact: true})
const frame = (page: Page) => page.locator('iframe.ph-frame').first().contentFrame()

async function open(page: Page, query: string) {
  await page.goto(explorer(query))
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  await view(page).scrollIntoViewIfNeeded()
}

/**
 * Bounding boxes of the stage, toolbar and frames, rounded to whole pixels, from the view's top: the story's evidence
 * above the view (the selection and its anchor) can wrap onto more lines as it changes, which moves the view with it.
 */
async function layout(page: Page) {
  const origin = (await view(page).boundingBox())!.y
  const boxes = async (locator: Locator) =>
    Promise.all(
      (await locator.all()).map(async element => {
        const box = await element.boundingBox()
        return box && [box.x, box.y - origin, box.width, box.height].map(Math.round).join(',')
      }),
    )
  return {
    stage: await boxes(page.locator('.ph-stage')),
    toolbar: await boxes(page.locator('.ph-toolbar')),
    frames: await boxes(page.locator('iframe.ph-frame')),
    workspace: await boxes(page.locator('.ph-workspace')),
  }
}

/** Whether the card is inside the viewport. */
async function inViewport(page: Page) {
  const box = (await card(page).boundingBox())!
  const viewport = page.viewportSize()!
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 0.5 && box.y + box.height <= viewport.height + 0.5
}

for (const size of [
  {width: 1440, height: 900},
  {width: 390, height: 844},
]) {
  test.describe(`at ${size.width}px`, () => {
    test.use({viewport: size})

    test('selecting an item opens its card without moving the stage, toolbar or frames, inside the viewport', async ({page}) => {
      await open(page, 'before=v1&after=v3&mode=side-by-side')
      const before = await layout(page)
      await frame(page).locator('[data-entity-id="payments"][role="button"]').first().click()
      await expect(output(page, 'Host selection')).toHaveText('payments')
      await expect(card(page)).toBeVisible()
      await expect(card(page).getByRole('heading', {name: 'Payments', level: 3})).toBeVisible()
      await expect(card(page)).toHaveAttribute('data-placement', size.width < 640 ? 'sheet' : /^(right|left|below|above|over)$/)
      expect(await layout(page)).toEqual(before)
      await expect.poll(() => inViewport(page)).toBe(true)
      // What changed, where in the code and connections; no identity, kind or confidence.
      await expect(card(page).getByRole('heading', {name: 'What changed'})).toBeVisible()
      await expect(card(page).locator('.ph-detail-status .ph-change-pill')).toHaveText(['Modified'])
      await expect(card(page).locator('[data-property-path="/retries"] ins')).toHaveText(/now 3$/)
      await expect(card(page).getByRole('heading', {name: 'Where in the code'})).toBeVisible()
      await expect(card(page).getByRole('heading', {name: 'Connections'})).toBeVisible()
      await expect(card(page)).not.toContainText('Identity')
      await expect(card(page)).not.toContainText('Confidence')
      // The card follows the page as it scrolls, and stays in view.
      await page.evaluate(() => scrollBy(0, 60))
      await expect.poll(() => inViewport(page)).toBe(true)
    })
  })
}

test('beside the item on wide stages: the card is next to the anchor the renderer reports', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900})
  await open(page, 'before=v1&after=v3')
  await frame(page).locator('[data-entity-id="payments"][role="button"]').first().click()
  await expect(card(page)).toBeVisible()
  const anchorText = output(page, 'Selection anchor')
  await expect(anchorText).not.toHaveText('none')
  await expect
    .poll(async () => {
      const anchor = JSON.parse((await anchorText.textContent())!) as {x: number; y: number; width: number; height: number}
      const box = (await card(page).boundingBox())!
      const side = await card(page).getAttribute('data-placement')
      if (side === 'right') return Math.round(box.x - (anchor.x + anchor.width))
      if (side === 'left') return Math.round(anchor.x - (box.x + box.width))
      if (side === 'below') return Math.round(box.y - (anchor.y + anchor.height))
      if (side === 'above') return Math.round(anchor.y - (box.y + box.height))
      return side
    })
    .toBe(8)
})

test('Escape closes the card and returns focus to the frame; a new selection opens it again', async ({page}) => {
  await open(page, 'before=v1&after=v3')
  await frame(page).locator('[data-entity-id="payments"][role="button"]').first().click()
  await expect(card(page)).toBeVisible()
  // Opening never takes focus from the renderer.
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME')
  await card(page).getByRole('button', {name: 'Close details'}).focus()
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('ph-frame'))).toBe(true)
  // The selection stays.
  await expect(output(page, 'Host selection')).toHaveText('payments')
  await frame(page).locator('[data-entity-id="checkout"][role="button"]').first().click()
  await expect(card(page).getByRole('heading', {name: 'Checkout', level: 3})).toBeVisible()
  await card(page).getByRole('button', {name: 'Close details'}).click()
  await expect(card(page)).toHaveCount(0)
})

test('a keyboard selection in the table moves focus to the card, and Escape returns it to the row', async ({page}) => {
  await open(page, 'before=v1&after=v3&view=table')
  const row = page.locator('.ph-table-view').getByRole('button', {name: 'Payments', exact: true})
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(card(page)).toBeVisible()
  await expect(card(page).getByRole('heading', {name: 'Payments', level: 3})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await expect(row).toBeFocused()
  // A pointer selection leaves focus where it is (WebKit doesn't focus a clicked button).
  await page.locator('.ph-table-view').getByRole('button', {name: 'Checkout', exact: true}).click()
  await expect(card(page).getByRole('heading', {name: 'Checkout', level: 3})).toBeVisible()
  await expect(card(page).getByRole('heading', {name: 'Checkout', level: 3})).not.toBeFocused()
})

test('a press elsewhere or an empty selection closes the card; the toolbar keeps it', async ({page}) => {
  await open(page, 'before=v1&after=v3')
  await frame(page).locator('[data-entity-id="payments"][role="button"]').first().click()
  await expect(card(page)).toBeVisible()
  // Toolbar controls act on what the card is about.
  await chooseMode(page, 'Side by side')
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'side-by-side')
  await expect(card(page)).toBeVisible()
  await showAs(page, 'Table')
  await expect(card(page)).toBeVisible()
  // A press on the page outside the view closes it; the selection stays.
  await page.locator('.demo-header h1').click()
  await expect(card(page)).toHaveCount(0)
  await expect(output(page, 'Host selection')).toHaveText('payments')
  // Selecting nothing closes it too.
  const table = page.locator('.ph-table-view')
  await table.getByRole('button', {name: 'Checkout', exact: true}).click()
  await expect(card(page)).toBeVisible()
  await table.getByRole('button', {name: 'Checkout', exact: true}).click()
  await expect(output(page, 'Host selection')).toHaveText('None')
  await expect(card(page)).toHaveCount(0)
})

test('a connection selects its item and moves the card; evidence asks the host to open the file', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900})
  await open(page, 'before=v1&after=v3')
  await frame(page).locator('[data-entity-id="payments"][role="button"]').first().click()
  await expect(card(page)).toHaveAttribute('data-detail-card', 'payments')
  const first = (await card(page).boundingBox())!
  // Payments → Audit log (calls), added: a relationship; its card lists its endpoints.
  await card(page).getByRole('button', {name: 'Payments → Audit log (calls), Added'}).click()
  await expect(output(page, 'Host selection')).toHaveText('audit-payments')
  await expect(card(page)).toHaveAttribute('data-detail-card', 'audit-payments')
  await expect(card(page).getByRole('heading', {level: 3})).toBeFocused()
  await card(page).getByRole('button', {name: 'To: Audit log, Added'}).click()
  await expect(output(page, 'Host selection')).toHaveText('audit')
  await expect(card(page).getByRole('heading', {name: 'Audit log', level: 3})).toBeFocused()
  await expect.poll(async () => JSON.stringify(await card(page).boundingBox())).not.toBe(JSON.stringify(first))
  // An added item's fields are its new values.
  await expect(card(page).locator('.ph-detail-status .ph-change-pill')).toHaveText(['Added'])
  await expect(card(page).locator('[data-property-path="/audited"] ins')).toHaveText(/now true$/)
  await card(page).getByRole('button', {name: 'src/checkout.ts:12'}).click()
  await expect(output(page, 'Open request')).toHaveText('src/checkout.ts:12')
})

test('details="none" leaves the selection to the embedder', async ({page}) => {
  await open(page, 'before=v1&after=v3&details=none&view=table')
  await page.locator('.ph-table-view').getByRole('button', {name: 'Payments', exact: true}).click()
  await expect(output(page, 'Host selection')).toHaveText('payments')
  await expect(card(page)).toHaveCount(0)
})
