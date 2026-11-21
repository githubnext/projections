import {test, expect} from '@playwright/test'
import type {FrameLocator, Page} from '@playwright/test'
import {
  chooseMode,
  chooseSetting,
  closeMenus,
  expectMode,
  explorer,
  modeControls,
  modeGroup,
  openSettings,
  pairSelect,
  showAs,
  submenuItem,
} from './harness.js'

const view = (page: Page) => page.locator('.ph')
const pane = (page: Page, side: 'before' | 'after'): FrameLocator => page.locator(`[data-side="${side}"] iframe.ph-frame`).contentFrame()
const entity = (frame: FrameLocator, id: string) => frame.locator(`[data-entity-id="${id}"]`).first()

async function open(page: Page, query: string) {
  await page.goto(explorer(query))
  await expect(page.locator('.ph-explorer')).toBeVisible()
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
}

test('side by side shows both revisions in labeled panes, without playback controls', async ({page}) => {
  await open(page, 'mode=side-by-side&before=v1&after=v3&connector')
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'side-by-side')
  await expectMode(page, 'Side by side')
  await expect(page.getByRole('region', {name: 'Before revision: v1 · base'})).toBeVisible()
  await expect(page.getByRole('region', {name: 'After revision: v3 · latest push'})).toBeVisible()
  await expect(page.getByRole('group', {name: 'Comparison playback'})).toHaveCount(0)
  await expect(submenuItem(await openSettings(page), 'Highlight changes')).toContainText('During the transition')
  await closeMenus(page)
  await expect(entity(pane(page, 'before'), 'legacy')).toBeVisible()
  await expect(pane(page, 'after').locator('[data-entity-id="legacy"]')).toHaveCount(0)
  await expect(entity(pane(page, 'after'), 'audit')).toBeVisible()
  // Playback is Animated's: the table and text views have none in side by side either.
  await showAs(page, 'Table')
  await expect(page.getByRole('group', {name: 'Comparison playback'})).toHaveCount(0)
  await expect(modeControls(page)).toHaveCount(0)
})

test('selection and hover in one pane mark the same entity in the other', async ({page}) => {
  await open(page, 'mode=side-by-side&before=v1&after=v3&connector')
  await entity(pane(page, 'before'), 'payments').click()
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('payments')
  await expect(entity(pane(page, 'after'), 'payments')).toHaveClass(/selected/)
  await expect(entity(pane(page, 'before'), 'payments')).toHaveClass(/selected/)
  // The detail card overlays the stage; close it to hover what it covers (the selection stays).
  await page.locator('[data-detail-card]').getByRole('button', {name: 'Close details'}).click()
  await entity(pane(page, 'after'), 'checkout').hover()
  await expect(entity(pane(page, 'before'), 'checkout')).toHaveAttribute('data-projections-hovered', '')
  await expect(entity(pane(page, 'after'), 'checkout')).toHaveAttribute('data-projections-hovered', '')
  await page.getByRole('group', {name: 'Projection toolbar'}).hover({position: {x: 4, y: 4}})
  await expect(pane(page, 'before').locator('[data-projections-hovered]')).toHaveCount(0)
})

test('a connector joins the selected entity in both panes and disappears without a counterpart', async ({page}) => {
  // At natural height every entity is in view in both panes; a filling view's stacked panes can scroll one out.
  await open(page, 'mode=side-by-side&before=v1&after=v3&connector&fill=false')
  await entity(pane(page, 'after'), 'payments').click()
  const panes = page.locator('.ph-panes')
  const stacked = await page.evaluate(() => {
    const [before, after] = [...document.querySelectorAll('.ph-pane')].map(element => element.getBoundingClientRect())
    return after!.top >= before!.bottom - 1
  })
  await expect(panes).toHaveAttribute('data-connector', stacked ? 'vertical' : 'horizontal')
  // The connector follows the anchors the panes report, which can trail their layout on a loaded runner.
  await expect(async () => {
    const origin = (await panes.boundingBox())!
    for (const side of ['before', 'after'] as const) {
      const end = page.locator(`.ph-connector circle[data-end="${side}"]`)
      const point = {x: origin.x + Number(await end.getAttribute('cx')), y: origin.y + Number(await end.getAttribute('cy'))}
      const box = (await entity(pane(page, side), 'payments').boundingBox())!
      expect(point.x).toBeGreaterThanOrEqual(box.x - 2)
      expect(point.x).toBeLessThanOrEqual(box.x + box.width + 2)
      expect(point.y).toBeGreaterThanOrEqual(box.y - 2)
      expect(point.y).toBeLessThanOrEqual(box.y + box.height + 2)
    }
  }).toPass()
  // Removed in the after revision and added in it: no counterpart, no connector. (The detail card overlays the stage,
  // so each next entity is clicked with the card closed.)
  const closeCard = () => page.locator('[data-detail-card]').getByRole('button', {name: 'Close details'}).click()
  await closeCard()
  await entity(pane(page, 'before'), 'legacy').click()
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('legacy')
  await expect(panes).toHaveAttribute('data-connector', 'none')
  await closeCard()
  await entity(pane(page, 'after'), 'audit').click()
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('audit')
  await expect(panes).toHaveAttribute('data-connector', 'none')
  // Back to an entity in both revisions: the connector returns (scrolled into view in both panes, which on a phone's
  // fitted panes can otherwise hold it out of sight; a connector never points at an entity that isn't shown).
  await closeCard()
  await entity(pane(page, 'before'), 'checkout').click()
  await entity(pane(page, 'after'), 'checkout').scrollIntoViewIfNeeded()
  await entity(pane(page, 'before'), 'checkout').scrollIntoViewIfNeeded()
  await expect(panes).not.toHaveAttribute('data-connector', 'none')
})

test('swipe stacks both revisions behind a divider moved by pointer and keyboard', async ({page}) => {
  await open(page, 'mode=swipe&before=v1&after=v3')
  const divider = page.getByRole('slider', {name: 'Comparison divider'})
  await expect(divider).toHaveAttribute('aria-valuenow', '50')
  await expect(page.getByRole('region', {name: 'Before revision: v1 · base'})).toBeAttached()
  await divider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(divider).toHaveAttribute('aria-valuenow', '51')
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(divider).toHaveAttribute('aria-valuenow', '41')
  await page.keyboard.press('End')
  await expect(divider).toHaveAttribute('aria-valuenow', '100')
  await page.keyboard.press('Home')
  await expect(divider).toHaveAttribute('aria-valuenow', '0')
  const swipe = (await page.locator('.ph-swipe').boundingBox())!
  const grab = (await page.locator('.ph-swipe-grab').boundingBox())!
  const y = grab.y + Math.min(grab.height / 2, 150)
  await page.mouse.move(grab.x + grab.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(swipe.x + swipe.width * 0.5, y, {steps: 4})
  await page.mouse.move(swipe.x + swipe.width * 0.25, y, {steps: 4})
  await page.mouse.up()
  const value = Number(await divider.getAttribute('aria-valuenow'))
  expect(value).toBeGreaterThanOrEqual(23)
  expect(value).toBeLessThanOrEqual(27)
  await expect(page.locator('.ph-swipe')).toHaveAttribute('style', /--ph-split: 2\d(\.\d)?%/)
})

test('scrolling one swipe layer scrolls the other', async ({page}) => {
  await open(page, 'mode=swipe&before=v1&after=v3')
  // Chromium doesn't run scroll events in offscreen cross-origin frames, so the layers must be on screen, as when a person scrolls them.
  await page.locator('.ph-swipe').scrollIntoViewIfNeeded()
  // Make the graph renderer's canvas wider than its viewport in both layers.
  for (const side of ['before', 'after'] as const) {
    await pane(page, side)
      .locator('.pk')
      .evaluate(root => {
        const scroller = root.querySelector<HTMLElement>('.graph-scroll') ?? root
        scroller.style.overflowX = 'auto'
        const wide = document.createElement('div')
        wide.style.width = '4000px'
        // The canvas scroller is a flex container; keep the spacer from shrinking.
        wide.style.flex = 'none'
        wide.style.height = '10px'
        scroller.append(wide)
      })
  }
  await pane(page, 'before')
    .locator('.pk')
    .evaluate(root => {
      const scroller = root.querySelector<HTMLElement>('.graph-scroll') ?? root
      scroller.scrollLeft = 300
    })
  await expect
    .poll(() =>
      pane(page, 'after')
        .locator('.pk')
        .evaluate(root => (root.querySelector<HTMLElement>('.graph-scroll') ?? root).scrollLeft),
    )
    .toBe(300)
  await pane(page, 'after')
    .locator('.pk')
    .evaluate(root => {
      ;(root.querySelector<HTMLElement>('.graph-scroll') ?? root).scrollLeft = 120
    })
  await expect
    .poll(() =>
      pane(page, 'before')
        .locator('.pk')
        .evaluate(root => (root.querySelector<HTMLElement>('.graph-scroll') ?? root).scrollLeft),
    )
    .toBe(120)
})

test('renderers without the interaction capabilities still share selection', async ({page}) => {
  await open(page, 'mode=side-by-side&before=v1&after=v3&renderer=minimal')
  await pane(page, 'before').locator('[data-entity-id="payments"] button').click()
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('payments')
  await expect(pane(page, 'after').locator('[data-entity-id="payments"]')).toHaveClass(/selected/)
  await expect(page.locator('.ph-panes')).toHaveAttribute('data-connector', 'none')
  await page.locator('[data-detail-card]').getByRole('button', {name: 'Close details'}).click()
  await pane(page, 'after').locator('[data-entity-id="payments"] button').hover()
  await expect(pane(page, 'before').locator('[data-projections-hovered]')).toHaveCount(0)
})

test('embedders can control the comparison mode and divider', async ({page}) => {
  await open(page, 'controlled&before=v1&after=v3')
  await expectMode(page, 'Animated')
  await page.getByRole('button', {name: 'Tour: side by side'}).click()
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'side-by-side')
  await chooseMode(page, 'Swipe')
  await expect(page.getByLabel('Tour mode')).toHaveText('swipe')
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'swipe')
  await page.getByRole('slider', {name: 'Comparison divider'}).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByLabel('Tour divider')).toHaveText('51%')
  await page.getByLabel('Ignore requests').check()
  // The embedder ignores the request, so the radio group keeps showing the controlled mode.
  await chooseMode(page, 'Animated')
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'swipe')
  await expectMode(page, 'Swipe')
  await page.getByLabel('Ignore requests').uncheck()
  await page.getByRole('button', {name: 'Tour: swipe at 30%'}).click()
  await expect(page.getByRole('slider', {name: 'Comparison divider'})).toHaveAttribute('aria-valuenow', '30')
  await page.getByRole('button', {name: 'Tour: animated'}).click()
  await expect(page.getByRole('group', {name: 'Comparison playback'})).toBeVisible()
})

test('a renderer failure is reported in the pane where it happens', async ({page}) => {
  await page.goto(explorer('mode=side-by-side&before=v1&after=v3&renderer=hostile&probe=navigate'))
  await expect(page.locator('[data-side="before"] [role="alert"]')).toContainText('navigated its frame and was stopped')
  await expect(page.locator('[data-side="after"] [role="alert"]')).toContainText('navigated its frame and was stopped')
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'failed')
})

test('a single extraction has no comparison mode control', async ({page}) => {
  await open(page, 'single&after=v2&mode=side-by-side')
  await expect(modeControls(page)).toHaveCount(0)
  await expect(page.locator('iframe.ph-frame')).toHaveCount(1)
})

test('the chosen mode and divider survive choosing another pair', async ({page}) => {
  await open(page, 'before=v1&after=v2')
  await chooseMode(page, 'Swipe')
  await page.getByRole('slider', {name: 'Comparison divider'}).focus()
  await page.keyboard.press('Shift+ArrowRight')
  await (await pairSelect(page, 'To')).selectOption('v3')
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'swipe')
  await expect(page.getByRole('slider', {name: 'Comparison divider'})).toHaveAttribute('aria-valuenow', '60')
  await expect(entity(pane(page, 'after'), 'audit')).toBeVisible()
})

test('arrow keys select comparison modes like native radios, and the choice cannot be cleared', async ({page}) => {
  await open(page, 'before=v1&after=v3')
  // Inline, or in the condensed row's mode menu (which stays open while the arrow keys move).
  const modes = await modeGroup(page)
  const radio = (name: string) => modes.getByRole('radio', {name})
  await expect(radio('Animated')).toBeChecked()
  await radio('Animated').focus()
  // Canonical order: side by side, animated, swipe.
  await page.keyboard.press('ArrowRight')
  await expect(radio('Swipe')).toBeFocused()
  await expect(radio('Swipe')).toBeChecked()
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'swipe')
  await page.keyboard.press('ArrowLeft')
  await expect(radio('Animated')).toBeChecked()
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'animated')
  await page.keyboard.press('ArrowLeft')
  await expect(radio('Side by side')).toBeChecked()
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'side-by-side')
  await expect(modes.getByRole('radio', {checked: true})).toHaveCount(1)
  // Activating the checked mode again, by key or click, keeps it selected (in the menu, activating closes it).
  await radio('Side by side').press('Space')
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'side-by-side')
  await expectMode(page, 'Side by side')
  await (await modeGroup(page)).getByRole('radio', {name: 'Side by side'}).click()
  await expect(view(page)).toHaveAttribute('data-comparison-mode', 'side-by-side')
  await expectMode(page, 'Side by side')
})

test('pane frames are named for assistive technology without a tooltip', async ({page}) => {
  await open(page, 'mode=side-by-side&before=v1&after=v3')
  const frames = page.locator('iframe.ph-frame')
  await expect(frames).toHaveCount(2)
  await expect(page.locator('[data-side="before"] iframe.ph-frame')).toHaveAccessibleName('Graph renderer, before revision')
  await expect(page.locator('[data-side="after"] iframe.ph-frame')).toHaveAccessibleName('Graph renderer, after revision')
  for (const frame of await frames.all()) await expect(frame).not.toHaveAttribute('title')
  // Back in animated mode the reused frame is renamed without reloading.
  await chooseMode(page, 'Animated')
  await expect(frames).toHaveCount(1)
  await expect(frames).toHaveAccessibleName('Graph renderer')
  await expect(frames).not.toHaveAttribute('title')
})

test('modes show in canonical order and open in diff, else side by side, when the renderer supports it', async ({page}) => {
  // The graph renderer declares all four: diff first and open.
  await open(page, 'before=v1&after=v3&mode=default')
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'diff')
  await expect((await modeGroup(page)).getByRole('radio')).toHaveText(['Diff', 'Side by side', 'Animated', 'Swipe'])
  await page.keyboard.press('Escape')
  // No declaration: the default three, side by side first and open.
  await open(page, 'renderer=minimal&before=v1&after=v3&mode=default')
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'side-by-side')
  await expect((await modeGroup(page)).getByRole('radio')).toHaveText(['Side by side', 'Animated', 'Swipe'])
  await page.keyboard.press('Escape')
  // Declared as animated then side by side, without swipe: still side by side first, and open.
  await open(page, 'renderer=hostile&probe=noswipe&before=v1&after=v3&mode=default')
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'side-by-side')
  await expect((await modeGroup(page)).getByRole('radio')).toHaveText(['Side by side', 'Animated'])
  await page.keyboard.press('Escape')
  // With diff, diff comes first in canonical order and opens.
  await open(page, 'renderer=hostile&probe=diff&before=v1&after=v3&mode=default')
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'diff')
  await expect((await modeGroup(page)).getByRole('radio')).toHaveText(['Diff', 'Animated'])
  await page.keyboard.press('Escape')
  // A diff-only renderer opens in diff, with no mode switch.
  await open(page, 'renderer=hostile&probe=diffonly&before=v1&after=v3&mode=default')
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'diff')
  await expect(page.getByRole('radiogroup', {name: 'Comparison mode'})).toHaveCount(0)
  await expect(page.getByRole('button', {name: /^Comparison mode/})).toHaveCount(0)
})

test('a renderer declaring diff gets one frame, init in diff mode and no progress', async ({page}) => {
  await open(page, 'renderer=hostile&probe=diff&before=v1&after=v3&mode=diff')
  const root = page.locator('.ph')
  // Only its modes are offered, in canonical order.
  await expect(root).toHaveAttribute('data-comparison-mode', 'diff')
  await expect((await modeGroup(page)).getByRole('radio')).toHaveText(['Diff', 'Animated'])
  await page.keyboard.press('Escape')
  await expect(page.locator('iframe.ph-frame')).toHaveCount(1)
  const report = page.getByRole('alert').filter({hasText: /init:/})
  await expect(report).toContainText('init:diff progress=0')
  // No playback outside animated mode.
  await expect(page.getByRole('slider', {name: 'Transition'})).toHaveCount(0)
  await page.waitForTimeout(300)
  await expect(report).toContainText('init:diff progress=0')
  // Turning highlighting off reaches the diff as one progress at 1 without emphasis, and back on with full emphasis.
  await chooseSetting(page, 'Off', 'Highlight changes')
  await expect(report).toContainText('init:diff progress=1 last=progress:1 highlighting=0')
  await chooseSetting(page, 'Always', 'Highlight changes')
  await expect(report).toContainText('init:diff progress=2 last=progress:1 highlighting=1')
  // Animated mode re-initializes the same frame for progress.
  await chooseMode(page, 'Animated')
  await expect(root).toHaveAttribute('data-comparison-mode', 'animated')
  await expect(report).toContainText('init:none progress=')
  await expect(page.locator('iframe.ph-frame')).toHaveCount(1)
  await expect(page.getByRole('slider', {name: 'Transition'})).toBeVisible()
})

test("a mode the renderer doesn't support falls back to its default", async ({page}) => {
  // The page asks for swipe; this renderer offers side by side and swipe, so swipe stays. Animated isn't offered.
  await open(page, 'renderer=hostile&probe=paired&before=v1&after=v3&mode=swipe')
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'swipe')
  await expect((await modeGroup(page)).getByRole('radio')).toHaveText(['Side by side', 'Swipe'])
  await page.keyboard.press('Escape')
  // Asked for animated, which it doesn't offer, it falls back to side by side.
  await open(page, 'renderer=hostile&probe=paired&before=v1&after=v3&mode=animated')
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'side-by-side')
  await expect(page.locator('iframe.ph-frame')).toHaveCount(2)
  await expect(page.getByRole('slider', {name: 'Transition'})).toHaveCount(0)
  // A diff-only renderer asked for swipe falls back to diff.
  await open(page, 'renderer=hostile&probe=diffonly&before=v1&after=v3&mode=swipe')
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'diff')
})

test('in swipe, each revision label is clipped with its own area as the divider moves', async ({page}) => {
  await page.goto(explorer('before=v1&after=v3&mode=swipe'))
  await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready')
  const label = (side: 'before' | 'after') => page.locator(`.ph-swipe-${side} .ph-swipe-label`)
  /** Whether the label is what a pointer would hit at its own center, that is, whether it shows there. */
  const shows = (side: 'before' | 'after') =>
    label(side).evaluate((element: HTMLElement) => {
      // Labels let the pointer through to the renderer; let it land on them for this check only.
      element.style.pointerEvents = 'auto'
      // The band spans the pane; its text sits at the before side's left or the after side's right.
      const box = (element.firstElementChild ?? element).getBoundingClientRect()
      return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))
    })
  // Each label belongs to its layer, so both keep their names and both show with the divider in the middle.
  for (const side of ['before', 'after'] as const) await expect(label(side)).toHaveCount(1)
  await expect.poll(() => shows('before')).toBe(true)
  await expect.poll(() => shows('after')).toBe(true)
  const divider = page.getByRole('slider', {name: 'Comparison divider'})
  await divider.focus()
  // All after: the before label is cut off with the before area.
  await page.keyboard.press('Home')
  await expect(divider).toHaveAttribute('aria-valuenow', '0')
  await expect.poll(() => shows('before')).toBe(false)
  await expect.poll(() => shows('after')).toBe(true)
  // All before: the after label goes with the after area.
  await page.keyboard.press('End')
  await expect(divider).toHaveAttribute('aria-valuenow', '100')
  await expect.poll(() => shows('after')).toBe(false)
  await expect.poll(() => shows('before')).toBe(true)
})

test('a view mounted before its renderer catalog loads keeps initialMode diff until the renderer declares it', async ({page}) => {
  // The catalog arrives late, so the view first has no renderer: the chosen mode must not be clamped to the defaults.
  await page.route('**/renderers/index.json', async route => {
    await new Promise(resolve => {
      setTimeout(resolve, 1500)
    })
    await route.continue()
  })
  await page.goto(explorer('before=v1&after=v3&mode=diff&lateCatalog'))
  await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready', {timeout: 20_000})
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'diff')
  await expect(page.locator('iframe.ph-frame')).toHaveCount(1)
})
