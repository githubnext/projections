import {test, expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'
import {explorer} from './harness.js'

/**
 * A host's own content at the stage's foot (`ProjectionViewProps.foot`): the foot's first row, over the legend, one
 * rule between them, in every mode; a cover the frames are told about, so no drawn node sits under it.
 */
type Box = {left: number; top: number; right: number; bottom: number}
const intersects = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5

async function pageBox(locator: Locator): Promise<Box> {
  const box = (await locator.boundingBox())!
  return {left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height}
}

/** Every drawn node's box in page coordinates, clipped to its frame. */
async function nodeBoxes(page: Page): Promise<Box[]> {
  const boxes: Box[] = []
  for (const iframe of await page.locator('iframe.ph-frame').all()) {
    const offset = (await iframe.boundingBox())!
    const inner = await iframe
      .contentFrame()!
      .locator('.node-surface')
      .evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON() as DOMRect))
    for (const box of inner) {
      const shown = {
        left: Math.max(box.left + offset.x, offset.x),
        top: Math.max(box.top + offset.y, offset.y),
        right: Math.min(box.right + offset.x, offset.x + offset.width),
        bottom: Math.min(box.bottom + offset.y, offset.y + offset.height),
      }
      if (shown.right > shown.left && shown.bottom > shown.top) boxes.push(shown)
    }
  }
  return boxes
}

for (const mode of ['diff', 'animated', 'side-by-side'] as const)
  test(`${mode}: a host's foot content is the foot's first row, and no node sits under the foot`, async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900})
    await page.goto(explorer(`mode=${mode}&footCaption`))
    await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready')
    await expect(page.locator('iframe.ph-frame').first().contentFrame()!.locator('.node-surface').first()).toBeVisible()
    const foot = page.locator('.ph-stage-foot')
    await expect(foot).toHaveCount(1)
    await expect(foot).toHaveAttribute('data-stage-cover', '')
    // The host's row first, the legend under it, one rule between them.
    const host = foot.locator(':scope > .ph-stage-foot-host')
    await expect(host.locator('.demo-foot-caption')).toBeVisible()
    expect(await foot.evaluate(element => element.firstElementChild?.classList.contains('ph-stage-foot-host'))).toBe(true)
    const legend = foot.locator('.ph-legend')
    await expect(legend).toBeVisible()
    expect(await host.evaluate(element => getComputedStyle(element).borderBottomWidth)).toBe('1px')
    expect(await legend.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px')
    // Every frame is told how far the foot reaches into it.
    for (const iframe of await page.locator('iframe.ph-frame').all()) {
      const html = iframe.contentFrame().locator('html')
      await expect
        .poll(() =>
          html.evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--projections-stage-inset-bottom')) || 0),
        )
        .toBeGreaterThan(0)
    }
    const covered = await pageBox(foot)
    await expect.poll(async () => (await nodeBoxes(page)).filter(node => intersects(node, covered)).length).toBe(0)
  })
