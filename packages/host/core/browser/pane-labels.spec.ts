import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {explorer} from './harness.js'

/**
 * Side by side and swipe show each revision held in its own pane: the host labels each pane in a header band above
 * it, which never covers the renderer's content.
 */
type Box = {left: number; top: number; right: number; bottom: number}
const intersects = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5

/** Every drawn node's box in page coordinates, across the renderer frames. */
async function nodeBoxes(page: Page): Promise<Box[]> {
  const boxes: Box[] = []
  for (const iframe of await page.locator('iframe.ph-frame').all()) {
    const offset = (await iframe.boundingBox())!
    const inner = await iframe
      .contentFrame()!
      .locator('.node-surface')
      .evaluateAll(nodes =>
        nodes.map(node => {
          const box = node.getBoundingClientRect()
          return {left: box.left, top: box.top, right: box.right, bottom: box.bottom}
        }),
      )
    // What shows of each node: its box clipped to the frame (a frame scrolls and clips what doesn't fit).
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

for (const [mode, label] of [
  ['side-by-side', '.ph-pane-label'],
  ['swipe', '.ph-swipe-label'],
] as const)
  for (const width of [1440, 768, 390])
    test(`${mode} at ${width}px: pane labels are bands that cover no node, and no pane narrates the transition`, async ({page}) => {
      await page.setViewportSize({width, height: 900})
      await page.goto(explorer(`before=v1&after=v3&mode=${mode}`))
      const view = page.locator('.ph')
      await expect(view).toHaveAttribute('data-comparison-mode', mode)
      await expect(view).toHaveAttribute('data-renderer-status', 'ready')
      const frames = page.locator('iframe.ph-frame')
      await expect(frames).toHaveCount(2)
      for (const frame of await frames.all()) {
        await expect(frame.contentFrame()!.locator('.node-surface').first()).toBeVisible()
        await expect(frame.contentFrame()!.locator('html')).toHaveAttribute('data-pane', /^(before|after)$/)
        await expect(frame.contentFrame()!.getByText('Identity connects the two states')).toHaveCount(0)
      }
      const labels = await page.locator(label).evaluateAll(elements =>
        elements.map(element => {
          const box = element.getBoundingClientRect()
          return {left: box.left, top: box.top, right: box.right, bottom: box.bottom}
        }),
      )
      expect(labels).toHaveLength(2)
      const nodes = await nodeBoxes(page)
      expect(nodes.length).toBeGreaterThan(0)
      for (const box of labels) for (const node of nodes) expect(intersects(box, node), JSON.stringify({box, node})).toBe(false)
      // Each band sits above its frame, never over it.
      for (const frame of await frames.all()) {
        const area = (await frame.boundingBox())!
        for (const box of labels)
          expect(intersects(box, {left: area.x, top: area.y, right: area.x + area.width, bottom: area.y + area.height})).toBe(false)
      }
    })

test('animated shows no transition caption: the footer strip takes no room without a focus', async ({page}) => {
  await page.goto(explorer('before=v1&after=v3&mode=animated'))
  await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready')
  const frame = page.locator('iframe.ph-frame').contentFrame()!
  await expect(frame.getByText('Identity connects the two states')).toHaveCount(0)
  await expect(frame.locator('.graph-footer')).toHaveCount(0)
})
