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

/** The width of the rules between the foot's rows, in order: each row's top edge plus the row above's bottom edge. */
const rules = (foot: Locator) =>
  foot.evaluate(element => {
    const rows = [...element.children].filter(row => row instanceof HTMLElement && row.offsetHeight > 0)
    return rows.slice(1).map((row, at) => {
      const above = parseFloat(getComputedStyle(rows[at]!).borderBottomWidth) || 0
      return above + (parseFloat(getComputedStyle(row).borderTopWidth) || 0)
    })
  })

async function open(page: Page, query: string) {
  await page.setViewportSize({width: 1440, height: 900})
  await page.goto(explorer(`${query}&footCaption`))
  await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready')
  const foot = page.locator('.ph-stage-foot')
  await expect(foot).toHaveCount(1)
  await expect(foot).toHaveAttribute('data-stage-cover', '')
  await expect(foot.locator(':scope > .ph-stage-foot-host:first-child .demo-foot-caption')).toBeVisible()
  return foot
}

for (const mode of ['diff', 'animated', 'side-by-side'] as const)
  test(`${mode}: a host's foot content is the foot's first row, one rule above the summary, and no node sits under the foot`, async ({
    page,
  }) => {
    const foot = await open(page, `mode=${mode}`)
    await expect(page.locator('iframe.ph-frame').first().contentFrame()!.locator('.node-surface').first()).toBeVisible()
    // Without a legend, the summary follows the host's row: one 1px rule between them, not two.
    await expect(foot.locator('.ph-legend')).toHaveCount(0)
    const widths = await rules(foot)
    expect(widths.length).toBeGreaterThan(0)
    expect(
      widths.every(width => width === 1),
      String(widths),
    ).toBe(true)
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

test("with a legend, the host's row comes first and one rule divides each row from the next", async ({page}) => {
  const foot = await open(page, 'renderer=hostile&probe=legend&before=v1&after=v3')
  await expect(foot.locator(':scope > .ph-legend')).toBeVisible()
  expect(await foot.evaluate(element => [...element.children].findIndex(row => row.classList.contains('ph-legend')))).toBe(1)
  const widths = await rules(foot)
  expect(
    widths.every(width => width === 1),
    String(widths),
  ).toBe(true)
})
