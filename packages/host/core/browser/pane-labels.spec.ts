import {test, expect, type Page} from '@playwright/test'
import {explorer, story} from './harness.js'

/**
 * Side by side and swipe show each revision held in its own pane: the host labels each pane in a header band above
 * it, which never covers the renderer's content.
 */
interface Box {
  left: number
  top: number
  right: number
  bottom: number
}
const intersects = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5

/** Every drawn node's box in page coordinates, across the renderer frames (or in `frames`). */
async function nodeBoxes(page: Page, frames = page.locator('iframe.ph-frame')): Promise<Box[]> {
  const boxes: Box[] = []
  for (const iframe of await frames.all()) {
    const offset = (await iframe.boundingBox())!
    const inner = await iframe
      .contentFrame()
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
] as const) {
  for (const width of [1440, 768, 390]) {
    test(`${mode} at ${width}px: pane labels are bands that cover no node, and no pane narrates the transition`, async ({page}) => {
      await page.setViewportSize({width, height: 900})
      await page.goto(explorer(`before=v1&after=v3&mode=${mode}`))
      const view = page.locator('.ph')
      await expect(view).toHaveAttribute('data-comparison-mode', mode)
      await expect(view).toHaveAttribute('data-renderer-status', 'ready')
      const frames = page.locator('iframe.ph-frame')
      await expect(frames).toHaveCount(2)
      for (const frame of await frames.all()) {
        await expect(frame.contentFrame().locator('.node-surface').first()).toBeVisible()
        await expect(frame.contentFrame().locator('html')).toHaveAttribute('data-pane', /^(before|after)$/u)
        await expect(frame.contentFrame().getByText('Identity connects the two states')).toHaveCount(0)
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
        for (const box of labels) {
          expect(intersects(box, {left: area.x, top: area.y, right: area.x + area.width, bottom: area.y + area.height})).toBe(false)
        }
      }
    })
  }
}

test('animated shows no transition caption: the footer strip takes no room without a focus', async ({page}) => {
  await page.goto(explorer('before=v1&after=v3&mode=animated'))
  await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready')
  const frame = page.locator('iframe.ph-frame').contentFrame()
  await expect(frame.getByText('Identity connects the two states')).toHaveCount(0)
  await expect(frame.locator('.graph-footer')).toHaveCount(0)
})

/** How far a chip sits from its frame's side without a bleeding stage (`chipInset`, stage/body.tsx): the kit's stage padding. */
const chipInset = 12
/** The space a chip takes at its frame's top, which the stage sends as `stage-inset-top` (`paneChipClearance`). */
const chipClearance = 52

for (const mode of ['side-by-side', 'swipe'] as const) {
  for (const fill of [false, true]) {
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
        const pane = (await section.boundingBox())!,
          frame = (await iframe.boundingBox())!,
          box = (await chip.boundingBox())!
        expect(Math.abs(frame.y - pane.y), `${side}: the frame starts at its pane's top`).toBeLessThanOrEqual(1)
        expect(box.y, `${side}: the chip is over the frame`).toBeGreaterThan(frame.y)
        expect([box.x % 1, box.y % 1], `${side}: the chip is on whole pixels`).toEqual([0, 0])
        expect(box.y + box.height).toBeLessThan(frame.y + chipClearance)
        // The after chip is at its pane's top right (in swipe, and side by side in columns), every other chip at the left.
        const stacked = (await page.locator('.ph-panes[data-stacked]').count()) > 0
        if (side === 'after' && !stacked) expect(Math.abs(frame.x + frame.width - chipInset - (box.x + box.width))).toBeLessThanOrEqual(1)
        else expect(Math.abs(box.x - (frame.x + chipInset))).toBeLessThanOrEqual(1)
        // Its own text is normal weight, and it takes the pointer, so hovering it shows its whole label.
        const style = await chip.evaluate(element => {
          const computed = getComputedStyle(element)
          return {weight: computed.fontWeight, pointer: computed.pointerEvents}
        })
        expect(style).toMatchObject({weight: '400', pointer: 'auto'})
        // The renderer is told how much of its top the chip takes, and starts its content below it.
        const inset = await iframe
          .contentFrame()
          .locator('html')
          .evaluate(html => getComputedStyle(html).getPropertyValue('--projections-stage-inset-top').trim())
        expect(inset).toBe(`${chipClearance}px`)
        // And exactly what covers it, in its own coordinates: its own chip, and in swipe the other side's too.
        const cover = await iframe
          .contentFrame()
          .locator('html')
          .evaluate(html => getComputedStyle(html).getPropertyValue('--projections-stage-cover').trim())
        const rects = cover.split(',').map(rect => rect.trim().split(' ').map(Number))
        expect(rects, cover).toHaveLength(mode === 'swipe' ? 2 : 1)
        expect(rects).toContainEqual([
          Math.round(box.x - frame.x),
          Math.round(box.y - frame.y),
          Math.round(box.width),
          Math.round(box.height),
        ])
        const chipBox = {left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height}
        for (const node of await nodeBoxes(page, iframe)) expect(intersects(chipBox, node), JSON.stringify({chipBox, node})).toBe(false)
      }
    })
  }
}

for (const fill of [false, true]) {
  test(`animated${fill ? ', filling,' : ''} with a utility area: the bar floats inset over the stage's top, and the frame keeps clear of it`, async ({
    page,
  }) => {
    await page.goto(story('harness-default-ui--core-only', `mode=animated&utility${fill ? '&fill' : ''}`))
    await expect(page.getByLabel('Custom status')).toHaveText('ready')
    const iframe = page.locator('iframe.ph-frame')
    await expect(iframe).toHaveCount(1)
    await expect(iframe.contentFrame().locator('.node-surface').first()).toBeVisible()
    const bar = page.locator('.ph-utility')
    const frame = (await iframe.boundingBox())!,
      box = (await bar.boundingBox())!
    // Inset 12px from the stage's top, centred on whole pixels, as wide as its content and its 1px edge.
    expect(Math.round(box.y - frame.y)).toBe(12)
    expect(box.width).toBe(322)
    expect(Math.abs(box.x + box.width / 2 - (frame.x + frame.width / 2))).toBeLessThanOrEqual(1)
    expect(box.x % 1, 'whole pixels').toBe(0)
    const tokens = await iframe
      .contentFrame()
      .locator('html')
      .evaluate(html => {
        const style = getComputedStyle(html)
        return {
          cover: style.getPropertyValue('--projections-stage-cover').trim(),
          top: style.getPropertyValue('--projections-stage-inset-top').trim(),
        }
      })
    expect(tokens).toEqual({cover: `${Math.round(box.x - frame.x)} 12 322 42`, top: '66px'})
    const barBox = {left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height}
    for (const node of await nodeBoxes(page, iframe)) expect(intersects(barBox, node), JSON.stringify({barBox, node})).toBe(false)
  })
}

test('in a stage laid out in its page, the bar sticks while the page scrolls, on whole pixels, and stops at the stage end', async ({
  page,
}) => {
  await page.setViewportSize({width: 1000, height: 360})
  await page.goto(story('harness-default-ui--core-only', 'mode=animated&utility'))
  await expect(page.getByLabel('Custom status')).toHaveText('ready')
  const bar = page.locator('.ph-utility')
  const stage = page.locator('.ph-stage-body')
  await expect(page.locator('iframe.ph-frame').contentFrame().locator('.node-surface').first()).toBeVisible()
  const rest = (await bar.boundingBox())!
  const body = (await stage.boundingBox())!
  // Scrolled partway down the stage, the bar is stuck 12px below the viewport's top (no host toolbar), on whole pixels.
  await page.evaluate(top => scrollTo(0, top), Math.round(body.y + 80) + 0.5)
  await expect.poll(async () => (await bar.boundingBox())!.y).toBe(12)
  const stuck = (await bar.boundingBox())!
  expect(stuck.x % 1, 'whole pixels across').toBe(0)
  expect(stuck.x).toBe(rest.x)
  // Past the stage's end it scrolls away with the stage, never overhanging it (room below lets the page scroll there).
  await page.evaluate(() => document.body.append(Object.assign(document.createElement('div'), {style: 'height: 1000px'})))
  await page.evaluate(top => scrollTo(0, top), Math.round(body.y + body.height - 20))
  expect(await page.evaluate(() => scrollY)).toBe(Math.round(body.y + body.height - 20))
  const end = (await bar.boundingBox())!
  const after = (await stage.boundingBox())!
  expect(end.y + end.height).toBeLessThanOrEqual(after.y + after.height + 0.5)
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
