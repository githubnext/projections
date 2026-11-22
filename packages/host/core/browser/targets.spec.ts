import {test, expect} from '@playwright/test'
import type {FrameLocator, Page} from '@playwright/test'
import {chooseMode, explorer} from './harness.js'

const view = (page: Page) => page.locator('.ph')
const output = (page: Page, label: string) => page.getByLabel(label, {exact: true})
const pane = (page: Page, side: 'before' | 'after'): FrameLocator => page.locator(`[data-side="${side}"] iframe.ph-frame`).contentFrame()
const frame = (page: Page): FrameLocator => page.locator('iframe.ph-frame').first().contentFrame()
const annotations = encodeURIComponent(
  JSON.stringify([
    {target: {kind: 'entity', id: 'payments', side: 'after'}, count: 2, label: '2 comments', tone: 'attention'},
    {target: {kind: 'entity', id: 'checkout', side: 'before'}, tone: 'done'},
  ]),
)

async function open(page: Page, query: string) {
  await page.goto(explorer(query))
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
}

async function selectTarget(page: Page, text: string) {
  await page.getByLabel('Target to select', {exact: true}).fill(text)
  await page.getByRole('button', {name: 'Select target', exact: true}).click()
}

/** A target the host reports for its selection. */
interface Target {
  kind: string
  id: string
  side: string
}
/** Where the host reports the selection is drawn. */
interface Anchor {
  x: number
  y: number
  width: number
  height: number
  side: string
}

async function anchor(page: Page): Promise<Anchor | 'none'> {
  const text = await output(page, 'Selection anchor').textContent()
  return text === 'none' || !text ? 'none' : (JSON.parse(text) as Anchor)
}

test('selecting an item in a renderer reports the targets it stands for', async ({page}) => {
  await open(page, 'before=v1&after=v3')
  await frame(page).locator('[data-entity-id="payments"][role="button"]').click()
  await expect(output(page, 'Host selection')).toHaveText('payments')
  const targets = JSON.parse((await output(page, 'Host selection targets').textContent()) ?? 'null') as Target[]
  expect(targets).toContainEqual({kind: 'entity', id: 'payments', side: 'after'})
  expect(targets.every(target => target.kind === 'entity' && target.id === 'payments')).toBe(true)
  // A single extraction has only an after side.
  await open(page, 'single&after=v3')
  await frame(page).locator('[data-entity-id="payments"][role="button"]').click()
  await expect(output(page, 'Host selection targets')).toHaveText(JSON.stringify([{kind: 'entity', id: 'payments', side: 'after'}]))
})

test('the host selects a target in the renderer, and reports targets it cannot present', async ({page}) => {
  await open(page, 'before=v1&after=v3')
  await selectTarget(page, 'entity.after.payments')
  await expect(output(page, 'Target resolution')).toContainText('"status":"present"')
  await expect(frame(page).locator('[data-entity-id="payments"][role="button"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(output(page, 'Host selection')).toHaveText('payments')
  // An absent target leaves the selection alone.
  await selectTarget(page, 'entity.after.nowhere')
  await expect(output(page, 'Target resolution')).toContainText('"status":"absent"')
  await expect(frame(page).locator('[data-entity-id="payments"][role="button"]')).toHaveAttribute('aria-pressed', 'true')
  // In side by side, the target is selected in both panes.
  await chooseMode(page, 'Side by side')
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  await expect(pane(page, 'before').locator('[data-entity-id="payments"][role="button"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(pane(page, 'after').locator('[data-entity-id="payments"][role="button"]')).toHaveAttribute('aria-pressed', 'true')
})

for (const renderer of ['auto']) {
  test(`renderer annotation badges select their item and report activation (${renderer})`, async ({page}) => {
    await open(page, `before=v1&after=v3&renderer=${renderer}&annotations=${annotations}`)
    const badge = frame(page).locator('[data-projections-annotation="payments"]')
    // Badges follow their items, and hide while an item is scrolled out of the renderer's view.
    await page.locator('iframe.ph-frame').scrollIntoViewIfNeeded()
    await frame(page)
      .locator('[data-entity-id="payments"]')
      .first()
      .evaluate(element => element.scrollIntoView({block: 'center'}))
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText('2')
    await expect(badge).toHaveAccessibleName(/^2 comments on /u)
    await expect(frame(page).locator('[data-entity-id="payments"][data-projections-annotated]').first()).toBeAttached()
    await badge.click()
    await expect(output(page, 'Annotation activations')).toHaveText('payments')
    await expect(output(page, 'Host selection')).toHaveText('payments')
    // Keyboard activation works too.
    const done = frame(page).locator('[data-projections-annotation="checkout"]')
    await frame(page)
      .locator('[data-entity-id="checkout"]')
      .first()
      .evaluate(element => element.scrollIntoView({block: 'center'}))
    // Selecting opens the detail card over the stage; the frame keeps its size.
    await expect(done).toBeVisible()
    await done.focus()
    await page.keyboard.press('Enter')
    await expect(output(page, 'Annotation activations')).toHaveText('payments, checkout')
  })
}

test('a renderer without the annotations capability still shares selection', async ({page}) => {
  await open(page, `before=v1&after=v3&renderer=minimal&annotations=${annotations}`)
  await expect(frame(page).locator('[data-projections-annotation]')).toHaveCount(0)
  await selectTarget(page, 'entity.after.payments')
  await expect(output(page, 'Target resolution')).toContainText('"status":"present"')
  await expect(frame(page).locator('[data-entity-id="payments"]')).toHaveClass(/selected/u)
})

test('the selection anchor follows the item through page scrolling and comparison modes', async ({page}) => {
  // At natural height the item stays in view in every mode's panes, so only page scrolling moves it.
  await open(page, 'before=v1&after=v3&fill=false')
  await selectTarget(page, 'entity.after.payments')
  await page.locator('iframe.ph-frame').scrollIntoViewIfNeeded()
  // The anchor is in host viewport coordinates: inside the frame, at a fixed offset from it while the host page scrolls.
  const offset = async () => {
    const current = await anchor(page)
    const box = await page.locator('iframe.ph-frame').boundingBox()
    if (current === 'none' || !box) return 'none'
    expect(current.side).toBe('after')
    expect(current.x).toBeGreaterThanOrEqual(Math.floor(box.x))
    expect(current.x + current.width).toBeLessThanOrEqual(Math.ceil(box.x + box.width) + 1)
    return `${Math.round(current.x - box.x)},${Math.round(current.y - box.y)}`
  }
  let settled = ''
  await expect
    .poll(async () => {
      const [first, second] = [await offset(), await page.waitForTimeout(200).then(offset)]
      settled = second
      return first !== 'none' && first === second
    })
    .toBe(true)
  // 40px down, or up when the frame scrolled into view leaves the page at its bottom (font metrics decide which).
  const scrolled = await page.evaluate(() => {
    const start = scrollY
    scrollBy(0, start + innerHeight + 40 <= document.documentElement.scrollHeight ? 40 : -40)
    return scrollY - start
  })
  expect(Math.abs(scrolled)).toBeGreaterThan(0)
  await expect.poll(offset).toBe(settled)
  // It keeps following in side by side and swipe, where the targeted side's pane is used.
  for (const [name, mode] of [
    ['Side by side', 'side-by-side'],
    ['Swipe', 'swipe'],
  ] as const) {
    await chooseMode(page, name)
    await expect(view(page)).toHaveAttribute('data-comparison-mode', mode)
    await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
    await page.locator('[data-side="after"] iframe.ph-frame').scrollIntoViewIfNeeded()
    // A narrow pane can open the graph canvas centred away from the item; bring it into the after pane's view.
    await pane(page, 'after')
      .locator('[data-entity-id="payments"]')
      .first()
      .evaluate(element => element.scrollIntoView({block: 'center', inline: 'center'}))
    await expect
      .poll(async () => {
        const current = await anchor(page)
        if (current === 'none') return 'none'
        const after = (await page.locator('[data-side="after"] iframe.ph-frame').boundingBox())!
        return current.side === 'after' && current.x >= Math.floor(after.x) && current.y >= Math.floor(after.y)
          ? 'inside after pane'
          : JSON.stringify(current)
      })
      .toBe('inside after pane')
  }
})

test('the selection anchor survives a mode change with no scrolling, where the frame keeps its size and place', async ({page}) => {
  // Stacked side by side and swipe put the after frame at the same size and place on a phone-wide stage.
  await page.setViewportSize({width: 390, height: 844})
  await open(page, 'before=v1&after=v3&fill=false&mode=side-by-side')
  await expect(page.locator('.ph-panes')).toHaveAttribute('data-stacked', 'true')
  await selectTarget(page, 'entity.after.payments')
  const inside = async () => {
    const current = await anchor(page)
    const after = await page.locator('[data-side="after"] iframe.ph-frame').boundingBox()
    if (current === 'none' || !after) return 'none'
    return current.side === 'after' && current.x >= Math.floor(after.x) && current.y >= Math.floor(after.y)
      ? 'inside after pane'
      : JSON.stringify(current)
  }
  await expect.poll(inside).toBe('inside after pane')
  await chooseMode(page, 'Swipe')
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'swipe')
  await expect.poll(inside).toBe('inside after pane')
})

test('relationships are selectable in a graph renderer and resolve to relationship targets', async ({page}) => {
  await open(page, 'before=v1&after=v3')
  await expect(page.locator('.ph-frame-host')).toHaveAttribute('data-renderer', 'graph')
  // A relationship without a label of its own is named by its endpoints, with a unicode arrow.
  const edge = frame(page).locator('.graph-link[data-entity-id="reserve"] .edge-hit').first()
  await expect(edge).toHaveAccessibleName(/^Inspect relationship .+ → .+ \(calls\)/u)
  const id = await frame(page).locator('.graph-link[data-entity-id="reserve"]').first().getAttribute('data-entity-id')
  await edge.focus()
  await page.keyboard.press('Enter')
  await expect(output(page, 'Host selection')).toHaveText(id!)
  const targets = JSON.parse((await output(page, 'Host selection targets').textContent()) ?? 'null') as Target[]
  expect(targets.length).toBeGreaterThan(0)
  expect(targets.every(target => target.kind === 'relationship')).toBe(true)
  // The host can select a relationship target back.
  const [first] = targets
  if (!first) throw new Error('The selection has no targets')
  await selectTarget(page, `relationship.${first.side}.${encodeURIComponent(first.id)}`)
  await expect(output(page, 'Target resolution')).toContainText('"status":"present"')
  await expect(output(page, 'Host selection')).toHaveText(id!)
})
