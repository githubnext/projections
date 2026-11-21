import {test, expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'
import {explorer} from './harness.js'

/**
 * A host's own content in the stage's utility area (`ProjectionViewProps.utility`): over the stage's top edge in the
 * one-frame modes, a cover the frames are told about, so no drawn node sits under it; with the floating playback too,
 * one bar, the host's content first. Side by side keeps its pane chips there instead.
 */
interface Box {
  left: number
  top: number
  right: number
  bottom: number
}
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

async function ready(page: Page, query: string) {
  await page.setViewportSize({width: 1440, height: 900})
  await page.goto(explorer(query))
  const view = page.locator('.ph')
  await expect(view).toHaveAttribute('data-renderer-status', 'ready')
  await expect(page.locator('iframe.ph-frame').first().contentFrame()!.locator('.node-surface').first()).toBeVisible()
}

for (const mode of ['diff', 'animated'] as const) {
  test(`${mode}: a host's utility content floats over the stage's top, and no node sits under it`, async ({page}) => {
    await ready(page, `mode=${mode}&caption`)
    const bar = page.locator('.ph-utility')
    await expect(bar).toHaveCount(1)
    await expect(bar).toHaveAttribute('data-stage-cover', '')
    await expect(bar.locator('.demo-caption')).toBeVisible()
    // The frame is told how far the bar reaches into it.
    const inset = page.locator('iframe.ph-frame').first().contentFrame()!.locator('html')
    await expect
      .poll(() => inset.evaluate(html => Number.parseFloat(getComputedStyle(html).getPropertyValue('--projections-stage-inset-top')) || 0))
      .toBeGreaterThan(0)
    const covered = await pageBox(bar)
    await expect.poll(async () => (await nodeBoxes(page)).filter(node => intersects(node, covered)).length).toBe(0)
  })
}

test('animated with floating playback: the host content and the playback share one bar, the host content first', async ({page}) => {
  await ready(page, 'mode=animated&utilityArea&caption')
  const bar = page.locator('.ph-utility')
  await expect(bar).toHaveCount(1)
  const caption = await pageBox(bar.locator('.demo-caption'))
  const playback = await pageBox(bar.locator('.ph-utility-playback'))
  expect(playback.top).toBeGreaterThanOrEqual(caption.bottom - 0.5)
  const covered = await pageBox(bar)
  await expect.poll(async () => (await nodeBoxes(page)).filter(node => intersects(node, covered)).length).toBe(0)
})

test("switching between diff and animated keeps the host's content mounted, its state and focus with it", async ({page}) => {
  await ready(page, 'mode=diff&utilityArea&caption=stateful')
  const note = page.locator('.ph-utility .demo-caption-note')
  await note.fill('kept')
  await note.evaluate(input => ((input as HTMLInputElement & {kept?: true}).kept = true))
  await page.locator('.ph-mode [data-mode="animated"]').click()
  await expect(page.locator('.ph-utility .ph-utility-playback')).toBeVisible()
  await note.focus()
  await page.locator('.ph-mode [data-mode="diff"]').evaluate(button => (button as HTMLElement).click())
  await expect(page.locator('.ph-utility .ph-utility-playback')).toHaveCount(0)
  await expect(note).toHaveValue('kept')
  await expect(note).toBeFocused()
  expect(await note.evaluate(input => (input as HTMLInputElement & {kept?: true}).kept)).toBe(true)
})

test('side by side keeps its pane chips at the top: the host content waits for a one-frame mode', async ({page}) => {
  await ready(page, 'mode=side-by-side&utilityArea&caption')
  await expect(page.locator('.demo-caption')).toHaveCount(0)
})
