import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {explorer, openSettings} from './harness.js'

const overflow = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth - innerWidth)
/** The first elements reaching past the viewport, to explain a failure. */
const wide = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter(
        element =>
          element.getBoundingClientRect().right > innerWidth + 1 ||
          (element.getBoundingClientRect().left + element.scrollWidth > innerWidth + 1 &&
            getComputedStyle(element).overflowX === 'visible'),
      )
      .map(element => `${element.tagName.toLowerCase()}.${String(element.className).split(' ').slice(0, 2).join('.')}`)
      .slice(-6)
      .join(', '),
  )

for (const [name, query] of [
  ['a comparison', 'before=v1&after=v3'],
  ['a single extraction', 'single&after=v3'],
] as const) {
  test(`the text view of ${name} wraps long IDs within the viewport`, async ({page}) => {
    await page.goto(explorer(`${query}&view=text&longIds`))
    const text = page.locator('.ph-text-view')
    await expect(text).toBeVisible()
    const item = text.locator('button[data-row-id^="payments."]').first()
    // The full text stays available, wrapped rather than truncated.
    await expect(item).toContainText(
      'payments.platform-services.internal.example.com/workloads/production/us-east-1/payments-deployment-controller-v2',
    )
    expect(await overflow(page), await wide(page)).toBeLessThanOrEqual(0)
    const box = (await item.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth))
    await item.click()
    await expect(item).toHaveAttribute('aria-pressed', 'true')
    expect(await overflow(page), await wide(page)).toBeLessThanOrEqual(0)
  })
}

test('human text is sentence case: nothing in the view or Settings is uppercased by style', async ({page}) => {
  await page.goto(explorer('before=v1&after=v3&mode=default'))
  await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
  await openSettings(page)
  const uppercased = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter(element => getComputedStyle(element).textTransform === 'uppercase' && element.textContent?.trim())
      .map(element => element.textContent!.trim().slice(0, 40)),
  )
  expect(uppercased).toEqual([])
})
