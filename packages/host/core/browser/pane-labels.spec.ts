import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {explorer, story} from './harness.js'

/**
 * Side by side and swipe show each revision held in its own pane: the host labels each pane in a header band above
 * it, which never covers the renderer's content.
 */
type Box = {left: number; top: number; right: number; bottom: number}
const intersects = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5

/** Every drawn node's box in page coordinates, across the renderer frames (or in `frames`). */
async function nodeBoxes(page: Page, frames = page.locator('iframe.ph-frame')): Promise<Box[]> {
  const boxes: Box[] = []
  for (const iframe of await frames.all()) {
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

/** How far a chip sits from its frame's side without a bleeding stage (`chipInset`, stage/body.tsx), CSS px. */
const chipInset = 8
/** The space a chip takes at its frame's top, which the stage sends as `stage-inset-top` (`paneChipClearance`). */
const chipClearance = 30

for (const mode of ['side-by-side', 'swipe'] as const)
  for (const fill of [false, true])
    test(`${mode}${fill ? ', filling,' : ''} with paneLabels="chips": quiet chips overlay each frame's top corner, clear of its nodes`, async ({
      page,
    }) => {
      await page.goto(story('harness-default-ui--core-only', `paneLabels=chips&mode=${mode}${fill ? '&fill' : ''}`))
      await expect(page.getByLabel('Custom status')).toHaveText('ready')
      await expect(page.locator('iframe.ph-frame')).toHaveCount(2)
      await expect(page.locator('[data-pane-band]')).toHaveCount(0)
      await expect(page.locator('[data-pane-chip]')).toHaveCount(2)
      for (const side of ['before', 'after'] as const) {
        const section = page.locator(`section[data-side="${side}"]`)
        const chip = section.locator('[data-pane-chip]')
        const iframe = section.locator('iframe.ph-frame')
        await expect(
          page.getByRole('region', {name: `${side === 'before' ? 'Before' : 'After'} revision: ${side === 'before' ? 'Base' : 'Head'}`}),
        ).toBeVisible()
        await expect(iframe.contentFrame().locator('.node-surface').first()).toBeVisible()
        // The frame starts at its pane's top: no strip is kept for the chip, which overlays the frame's top corner.
        const [pane, frame, box] = (await Promise.all([section.boundingBox(), iframe.boundingBox(), chip.boundingBox()])).map(
          value => value!,
        )
        expect(Math.abs(frame.y - pane.y), `${side}: the frame starts at its pane's top`).toBeLessThanOrEqual(1)
        expect(box.y, `${side}: the chip is over the frame`).toBeGreaterThan(frame.y)
        expect(box.y + box.height).toBeLessThan(frame.y + chipClearance)
        // Swipe's after chip is at the top right, every other chip at its pane's top left.
        if (mode === 'swipe' && side === 'after')
          expect(Math.abs(frame.x + frame.width - chipInset - (box.x + box.width))).toBeLessThanOrEqual(1)
        else expect(Math.abs(box.x - (frame.x + chipInset))).toBeLessThanOrEqual(1)
        // Quiet: normal weight, muted, and it never takes the pointer from the renderer under it.
        const style = await chip.evaluate(element => {
          const computed = getComputedStyle(element)
          return {weight: computed.fontWeight, pointer: computed.pointerEvents}
        })
        expect(style).toMatchObject({weight: '400', pointer: 'none'})
        // The renderer is told how much of its top the chip takes, and starts its content below it.
        const inset = await iframe
          .contentFrame()
          .locator('html')
          .evaluate(html => getComputedStyle(html).getPropertyValue('--projections-stage-inset-top').trim())
        expect(inset).toBe(`${chipClearance}px`)
        const chipBox = {left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height}
        for (const node of await nodeBoxes(page, iframe)) expect(intersects(chipBox, node), JSON.stringify({chipBox, node})).toBe(false)
      }
    })

test('without chips the frames get no top inset', async ({page}) => {
  await page.goto(story('harness-default-ui--core-only'))
  await expect(page.getByLabel('Custom status')).toHaveText('ready')
  for (const iframe of await page.locator('iframe.ph-frame').all()) {
    await expect(iframe.contentFrame().locator('.node-surface').first()).toBeVisible()
    const inset = await iframe
      .contentFrame()
      .locator('html')
      .evaluate(html => getComputedStyle(html).getPropertyValue('--projections-stage-inset-top'))
    expect(inset).toBe('')
  }
})
