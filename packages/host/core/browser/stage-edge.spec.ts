import {test, expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'
import {explorer} from './harness.js'

/**
 * A host's own content on the stage's bottom edge (`ProjectionViewProps.edge`): centred on the edge, half over the stage
 * and half below it, in every mode. Only its half over the stage counts as a cover, so each frame's inset is that half
 * and no drawn node sits under it; the legend and summary float above it as their own foot, apart.
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

async function open(page: Page, query: string) {
  await page.setViewportSize({width: 1440, height: 900})
  await page.goto(explorer(`${query}&edgeCaption`))
  await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready')
  const edge = page.locator('.ph-stage-edge-content')
  await expect(edge.locator('.demo-edge-caption')).toBeVisible()
  await expect(edge).toHaveAttribute('data-stage-cover', '')
  return edge
}

for (const mode of ['diff', 'animated', 'side-by-side', 'swipe'] as const)
  test(`${mode}: a host's edge content straddles the stage's bottom edge, and only its inner half is kept clear`, async ({page}) => {
    const edge = await open(page, `mode=${mode}`)
    await expect(page.locator('iframe.ph-frame').first().contentFrame()!.locator('.node-surface').first()).toBeVisible()
    const box = await pageBox(edge)
    const body = await pageBox(page.locator('.ph-stage-body'))
    // Centred on the edge: half over the stage, half below it.
    expect(Math.abs((box.top + box.bottom) / 2 - body.bottom)).toBeLessThanOrEqual(1)
    // Each frame keeps clear of the band from its bottom to the highest cover there: the summary's foot floating above
    // the edge content, or the edge content's half over the stage; its half below the stage adds nothing.
    const foot = page.locator('.ph-stage-foot')
    const top = (await foot.isVisible()) ? Math.min(box.top, (await pageBox(foot)).top) : box.top
    for (const iframe of await page.locator('iframe.ph-frame').all()) {
      const frame = await pageBox(iframe)
      if (frame.bottom <= box.top || frame.right <= box.left || frame.left >= box.right) continue
      const html = iframe.contentFrame().locator('html')
      const half = frame.bottom - top
      await expect
        .poll(async () =>
          Math.abs(
            (await html.evaluate(
              element => parseFloat(getComputedStyle(element).getPropertyValue('--projections-stage-inset-bottom')) || 0,
            )) - half,
          ),
        )
        .toBeLessThanOrEqual(1)
    }
    const inner = {...box, bottom: Math.min(box.bottom, body.bottom)}
    await expect.poll(async () => (await nodeBoxes(page)).filter(node => intersects(node, inner)).length).toBe(0)
    // The summary's foot floats above it, apart: not around it, and not over it.
    if (await foot.isVisible()) {
      expect(await foot.locator('.demo-edge-caption').count()).toBe(0)
      expect((await pageBox(foot)).bottom).toBeLessThanOrEqual(box.top - 7.5)
    }
  })

test('with a legend, the legend floats above the edge content in its own foot', async ({page}) => {
  const edge = await open(page, 'renderer=hostile&probe=legend&before=v1&after=v3')
  const legend = page.locator('.ph-stage-foot .ph-legend')
  await expect(legend).toBeVisible()
  expect((await pageBox(page.locator('.ph-stage-foot'))).bottom).toBeLessThanOrEqual((await pageBox(edge)).top - 7.5)
})
