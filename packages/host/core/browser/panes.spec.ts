import {test, expect, type FrameLocator, type Page} from '@playwright/test'
import {explorer, openSettings} from './harness.js'

/**
 * How side by side links its panes: no connector by default (the `connector` prop opts in; no setting toggles it),
 * the same selection and annotations in both panes, and a brief pulse on the counterpart of a selection.
 */
const view = (page: Page) => page.locator('.ph')
const pane = (page: Page, side: 'before' | 'after'): FrameLocator => page.locator(`[data-side="${side}"] iframe.ph-frame`).contentFrame()
const entity = (frame: FrameLocator, id: string) => frame.locator(`[data-entity-id="${id}"]`).first()

async function open(page: Page, query: string) {
  await page.goto(explorer(query))
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  await expect(page.locator('iframe.ph-frame')).toHaveCount(2)
}

/** Records, inside a pane, whether any element of `id` gets `data-projections-pulse`, and for how long. */
async function watchPulse(frame: FrameLocator, id: string) {
  await frame.locator('body').evaluate((body, watchedId) => {
    const record = {seen: false, start: 0, end: 0}
    ;(window as unknown as {pulse: typeof record}).pulse = record
    new MutationObserver(records => {
      for (const change of records) {
        const element = change.target as Element
        if (element.getAttribute('data-entity-id') !== watchedId) continue
        if (element.hasAttribute('data-projections-pulse')) {
          record.seen = true
          record.start ||= performance.now()
        } else if (record.start) record.end = performance.now()
      }
    }).observe(body, {subtree: true, attributes: true, attributeFilter: ['data-projections-pulse']})
  }, id)
  return () => frame.locator('body').evaluate(() => (window as unknown as {pulse: {seen: boolean; start: number; end: number}}).pulse)
}

test('side by side draws no connector by default and offers no setting for one', async ({page}) => {
  await open(page, 'mode=side-by-side&before=v1&after=v3&fill=false')
  await entity(pane(page, 'before'), 'payments').click()
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('payments')
  await expect(entity(pane(page, 'after'), 'payments')).toHaveClass(/selected/u)
  await expect(page.locator('.ph-panes')).toHaveAttribute('data-connector', 'none')
  await expect(page.locator('.ph-connector')).toHaveCount(0)
  await expect((await openSettings(page)).getByLabel('Show connector')).toHaveCount(0)
})

test('the connector prop (?connector) still draws one', async ({page}) => {
  await open(page, 'mode=side-by-side&before=v1&after=v3&connector&fill=false')
  await entity(pane(page, 'before'), 'payments').click()
  await expect(page.locator('.ph-panes')).not.toHaveAttribute('data-connector', 'none')
  await expect(page.locator('.ph-connector')).toHaveCount(1)
})

test('selecting in one pane selects the counterpart in the other, which pulses briefly', async ({page}) => {
  await open(page, 'mode=side-by-side&before=v1&after=v3&fill=false')
  const pulse = await watchPulse(pane(page, 'after'), 'payments')
  await entity(pane(page, 'before'), 'payments').click()
  await expect(entity(pane(page, 'after'), 'payments')).toHaveClass(/selected/u)
  // On a phone the panes stack, and a frame scrolled out of view paints (and pulses) once it is shown.
  await page.locator('[data-side="after"] iframe.ph-frame').scrollIntoViewIfNeeded()
  await expect.poll(async () => (await pulse()).seen).toBe(true)
  // It ends on its own, after about 900 ms.
  await expect(pane(page, 'after').locator('[data-projections-pulse]')).toHaveCount(0, {timeout: 5_000})
  const {start, end} = await pulse()
  expect(end - start).toBeGreaterThan(500)
})

test('reduced motion selects the counterpart without a pulse', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'})
  await open(page, 'mode=side-by-side&before=v1&after=v3&fill=false')
  const pulse = await watchPulse(pane(page, 'after'), 'payments')
  await entity(pane(page, 'before'), 'payments').click()
  await expect(entity(pane(page, 'after'), 'payments')).toHaveClass(/selected/u)
  await page.waitForTimeout(1_200)
  expect((await pulse()).seen).toBe(false)
})

test('annotations show in both panes', async ({page}) => {
  const annotations = encodeURIComponent(
    JSON.stringify([{target: {kind: 'entity', id: 'payments', side: 'after'}, count: 2, label: '2 comments', tone: 'attention'}]),
  )
  await open(page, `mode=side-by-side&before=v1&after=v3&fill=false&annotations=${annotations}`)
  for (const side of ['before', 'after'] as const) {
    const frame = pane(page, side)
    await page.locator(`[data-side="${side}"] iframe.ph-frame`).scrollIntoViewIfNeeded()
    await frame
      .locator('[data-entity-id="payments"]')
      .first()
      .evaluate(element => element.scrollIntoView({block: 'center'}))
    const badge = frame.locator('[data-projections-annotation="payments"]')
    await expect(badge, side).toBeVisible()
    await expect(badge, side).toHaveText('2')
  }
})
