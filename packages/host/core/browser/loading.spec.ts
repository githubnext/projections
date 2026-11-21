import {test, expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'
import {explorer} from './harness.js'

// Loading states are centered in the box they stand in for and fill it, so nothing moves when the content arrives.

/**
 * The status's spinner and label sit within 4px of the center of the area's content box (inside its border and padding), and the
 * status fills that box. Measured in one frame, once the layout has settled (side-by-side panes stack when narrow).
 */
async function expectCentered(status: Locator, area: Locator) {
  await expect(status).toBeVisible()
  await expect(status).toHaveAttribute('role', 'status')
  await expect(status).toHaveAttribute('aria-live', 'polite')
  expect(await status.evaluate(element => getComputedStyle(element).textTransform)).toBe('none')
  const target = await area.elementHandle()
  await expect
    .poll(() =>
      status.evaluate((element, box) => {
        const style = getComputedStyle(box!)
        const outer = box!.getBoundingClientRect()
        const top = outer.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)
        const height =
          outer.height -
          parseFloat(style.borderTopWidth) -
          parseFloat(style.borderBottomWidth) -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom)
        const content = element.querySelector('.ph-loading-content')!.getBoundingClientRect()
        const x = Math.abs(content.left + content.width / 2 - (outer.left + outer.width / 2))
        const y = Math.abs(content.top + content.height / 2 - (top + height / 2))
        const fill = Math.abs(element.getBoundingClientRect().height - height)
        return {x, y, fill, centered: x <= 4 && y <= 4, filled: fill <= 1}
      }, target),
    )
    .toMatchObject({centered: true, filled: true})
}

/** Holds every renderer bundle's page, so its frame stays loading (until the host's ready deadline). */
const holdRenderers = (page: Page) => page.route(/\/renderers\/[^/]+\/index\.html/, () => {})

const sizes = [
  {name: 'at this viewport', viewport: undefined},
  {name: 'at 390px wide', viewport: {width: 390, height: 844}},
]

for (const {name, viewport} of sizes) {
  test(`the renderer loading status is centered in the stage ${name}`, async ({page}) => {
    if (viewport) await page.setViewportSize(viewport)
    await holdRenderers(page)
    await page.goto(explorer())
    const pane = page.locator('.ph-frame-host[data-renderer-status="loading"]')
    const status = pane.locator('.ph-loading')
    await expect(status).toContainText(/Loading the .* renderer…/)
    // The stage's single card, inside its edge.
    await expectCentered(status, page.locator('.ph-stage .ph-single'))
    // The frame keeps its place under the status, filling the stage: revealing it moves nothing.
    await expectCentered(status, pane)
  })

  test(`starting the engine is centered in the explorer's place ${name}`, async ({page}) => {
    if (viewport) await page.setViewportSize(viewport)
    await page.route(/\.wasm(\?|$)/, () => {})
    await page.goto(explorer())
    const status = page.locator('.demo-sized .ph-loading')
    await expect(status).toContainText('Starting the engine…')
    await expectCentered(status, page.locator('.demo-sized'))
  })
}

test('side by side, while both panes load, one status is centered on the stage', async ({page}) => {
  await holdRenderers(page)
  await page.goto(explorer('mode=side-by-side'))
  const panes = page.locator('.ph-frame-host[data-renderer-status="loading"]')
  await expect(panes).toHaveCount(2)
  await expect(panes.locator('.ph-loading')).toHaveCount(0)
  await expectCentered(page.locator('.ph-stage-status .ph-loading'), page.locator('.ph-stage-body'))
})

test('under reduced motion the loading indicator is static', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'})
  await holdRenderers(page)
  await page.goto(explorer())
  const status = page.locator('.ph-frame-host .ph-loading')
  await expect(status).toHaveAttribute('data-motion', 'reduced')
  expect(await status.evaluate(element => element.getAnimations({subtree: true}).length)).toBe(0)
  await page.emulateMedia({reducedMotion: 'no-preference'})
  await expect(status).toHaveAttribute('data-motion', 'full')
  expect(await status.evaluate(element => element.getAnimations({subtree: true}).length)).toBeGreaterThan(0)
})
