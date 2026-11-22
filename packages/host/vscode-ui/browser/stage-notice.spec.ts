import {test, expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'
import {capGaps, expectCentred} from './cap.js'
import {contrast, ready, story} from './harness.js'
import type {ThemeId} from './harness.js'

/**
 * The stage notice (a VS Code tab's "Out of date · N files changed" with Refresh): a pill floating over the stage's top
 * centre, 12px in, not a toolbar control. It overlaps no toolbar control, stays put while the view scrolls under it,
 * draws an edge of at least 3:1 against its tinted fill, centres its text by cap height, and keeps Refresh whole on a
 * narrow tab.
 */
const pill = (page: Page) => page.locator('.phv-stage-notice')

/** Once the pill's entrance has finished, so its box is where it rests. */
async function settled(page: Page) {
  await pill(page).waitFor()
  await pill(page).evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}
const box = (locator: Locator) =>
  locator.evaluate(element => {
    const {left, top, right, bottom, width, height} = element.getBoundingClientRect()
    return {left, top, right, bottom, width, height}
  })
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** Where the pill sits: not in the toolbar, and its box against the stage's (the workspace) and every toolbar control's. */
async function placement(page: Page) {
  const notice = pill(page)
  return {
    inToolbar: await notice.evaluate(element => Boolean(element.closest('.phv-toolbar, .phv-toolbar-wrap'))),
    pill: await box(notice),
    stage: await box(page.locator('.phv-workspace').first()),
    controls: await page
      .locator('.phv-toolbar')
      .first()
      .evaluate(toolbar =>
        [
          ...toolbar.querySelectorAll(
            'button, [role="button"], [role="radio"], input, [tabindex], [class^="vscode-"], vscode-toolbar-button',
          ),
        ]
          .map(element => element.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0)
          .map(({left, top, right, bottom, width, height}) => ({left, top, right, bottom, width, height})),
      ),
  }
}

/**
 * The pill's colors as opaque sRGB, painted on a canvas as the page composes them: the fill (the warning tint over the
 * widget background), the edge over the fill, the icon and the text.
 */
const pillColors = (page: Page) =>
  pill(page).evaluate(element => {
    const style = getComputedStyle(element)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', {willReadFrequently: true})!
    const paint = (...layers: string[]) => {
      context.clearRect(0, 0, 1, 1)
      for (const layer of layers) {
        context.fillStyle = layer
        context.fillRect(0, 0, 1, 1)
      }
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data
      return `rgb(${r}, ${g}, ${b})`
    }
    // A custom property holds its declared value: resolve it as a color on a probe.
    const probe = document.createElement('span')
    element.append(probe)
    probe.style.color = style.getPropertyValue('--phv-stage-notice-fill').trim()
    const tint = getComputedStyle(probe).color
    probe.remove()
    const fill = paint(style.backgroundColor, tint)
    const icon = getComputedStyle(element.querySelector('.phv-stage-notice-icon')!).color
    return {
      fill,
      edge: paint(fill, style.borderTopColor),
      icon: paint(fill, icon),
      text: paint(fill, style.color),
    }
  })

test.use({viewport: {width: 1280, height: 800}, deviceScaleFactor: 2})

for (const theme of ['dark-modern', 'light-modern', 'dark-high-contrast', 'light-high-contrast', 'solarized-dark'] as ThemeId[]) {
  test(`${theme}: the notice floats over the stage's top centre, its edge and icon at least 3:1 against its fill`, async ({page}) => {
    await page.goto(story('projection-view--out-of-date', theme))
    await ready(page)
    await settled(page)
    const where = await placement(page)
    const measured = JSON.stringify({pill: where.pill, stage: where.stage})
    test.info().annotations.push({type: 'placement', description: measured})
    expect(where.inToolbar, 'the notice is not in the toolbar').toBe(false)
    expect(Math.abs(where.pill.left + where.pill.width / 2 - (where.stage.left + where.stage.width / 2)), measured).toBeLessThanOrEqual(1)
    expect(Math.abs(where.pill.top - where.stage.top - 12), measured).toBeLessThanOrEqual(1)
    expect(where.controls.length).toBeGreaterThan(0)
    for (const control of where.controls) expect(overlaps(where.pill, control), JSON.stringify(control)).toBe(false)
    await expect(pill(page)).toHaveAttribute('role', 'status')
    await expect(pill(page).getByRole('button', {name: 'Refresh'})).toBeVisible()

    const colors = await pillColors(page)
    const ratios = {
      edge: contrast(colors.edge, colors.fill),
      icon: contrast(colors.icon, colors.fill),
      text: contrast(colors.text, colors.fill),
    }
    test.info().annotations.push({type: 'contrast', description: JSON.stringify({...colors, ...ratios})})
    expect.soft(ratios.edge, `edge ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(3)
    expect.soft(ratios.icon, `icon ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(3)
    expect.soft(ratios.text, `text ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(4.5)
  })
}

test('a capital E sits optically centred in the notice and in its Refresh button', async ({page}) => {
  await page.goto(story('projection-view--out-of-date'))
  await ready(page)
  await settled(page)
  await page.mouse.move(0, 0)
  const notice = pill(page)
  expectCentred(await capGaps(page, notice, notice.locator('.phv-stage-notice-label'), true), 'notice', true)
  const refresh = notice.locator('.phv-stage-notice-action')
  expectCentred(await capGaps(page, refresh, refresh.locator('.phv-cap'), true), 'Refresh', true)
})

test('the notice stays put while a document-style renderer scrolls under it', async ({page}) => {
  await page.goto(story('projection-view--out-of-date-document'))
  await ready(page)
  await settled(page)
  const before = await box(pill(page))
  // The renderer's document scrolls inside its frame: scroll whatever scrolls there.
  const scrolled = await page
    .frameLocator('iframe.ph-frame')
    .first()
    .locator('body')
    .evaluate(body => {
      const document = body.ownerDocument
      const scrollers = [document.scrollingElement!, ...document.querySelectorAll('*')].filter(
        element =>
          element.scrollHeight > element.clientHeight + 40 &&
          (element === document.scrollingElement || /auto|scroll/.test(getComputedStyle(element).overflowY)),
      )
      for (const element of scrollers) element.scrollTop = 600
      return Math.max(0, ...scrollers.map(element => element.scrollTop))
    })
  expect(scrolled, 'the document scrolled').toBeGreaterThan(100)
  await page.waitForTimeout(100)
  expect(await box(pill(page))).toEqual(before)
})

test('the notice stays put while the table view scrolls under it', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 480})
  await page.goto(story('projection-view--out-of-date', 'dark-modern', 'initialView:table'))
  await ready(page)
  await settled(page)
  const before = await box(pill(page))
  const table = page.locator('.phv-main > .phv-table-view')
  const scrolled = await table.evaluate(element => {
    element.scrollTop = 400
    return element.scrollTop
  })
  expect(scrolled, 'the table scrolled').toBeGreaterThan(100)
  await page.waitForTimeout(100)
  expect(await box(pill(page))).toEqual(before)
})

for (const width of [320, 400]) {
  test(`${width}px wide: the notice fits the stage on one line, the count truncating first and Refresh whole`, async ({page}) => {
    await page.setViewportSize({width, height: 700})
    await page.goto(story('projection-view--out-of-date'))
    await ready(page)
    await settled(page)
    const where = await placement(page)
    const measured = JSON.stringify({pill: where.pill, stage: where.stage})
    expect(where.pill.left, measured).toBeGreaterThanOrEqual(where.stage.left + 12 - 1)
    expect(where.pill.right, measured).toBeLessThanOrEqual(where.stage.right - 12 + 1)
    expect(Math.abs(where.pill.top - where.stage.top - 12), measured).toBeLessThanOrEqual(1)
    expect(where.pill.height, 'one line').toBeLessThanOrEqual(27)
    for (const control of where.controls) expect(overlaps(where.pill, control), JSON.stringify(control)).toBe(false)
    const refresh = pill(page).getByRole('button', {name: 'Refresh'})
    await expect(refresh).toBeVisible()
    const action = await box(refresh)
    expect(action.left).toBeGreaterThanOrEqual(where.pill.left)
    expect(action.right).toBeLessThanOrEqual(where.pill.right)
    // The label is never cut; the count may be.
    const label = pill(page).locator('.phv-stage-notice-label')
    expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth + 0.5)).toBe(true)
    await refresh.focus()
    await expect(refresh).toBeFocused()
  })
}

/**
 * With header bands over the panes (side by side and swipe), the pill covers no revision name: 12px below the bands
 * along the stage's top (the top pane's when side by side stacks them), still centred over the whole stage.
 */
for (const mode of ['side-by-side', 'swipe'] as const) {
  for (const width of [1280, 360]) {
    test(`${mode}, ${width}px wide: the notice sits 12px below the pane header bands, over none of them`, async ({page}) => {
      await page.setViewportSize({width, height: 800})
      await page.goto(story('projection-view--out-of-date', 'dark-modern', `initialMode:${mode}`))
      await ready(page)
      await settled(page)
      const panes = page.locator(mode === 'swipe' ? '.ph-swipe' : '.ph-panes').first()
      await expect(panes).toBeVisible()
      // Narrow, side by side stacks its panes: the after pane's band is mid-stage, under the pill's line of sight.
      if (mode === 'side-by-side' && width < 640) await expect(panes).toHaveAttribute('data-stacked')
      const bands = await page.locator('[data-pane-band]').evaluateAll(elements =>
        elements.map(element => {
          const {left, top, right, bottom, width, height} = element.getBoundingClientRect()
          return {left, top, right, bottom, width, height}
        }),
      )
      expect(bands.length).toBe(2)
      // Placed after the bands lay out: the slot follows them.
      const topBands = bands.filter(band => band.top <= Math.min(...bands.map(other => other.top)) + 1)
      const expected = Math.max(...topBands.map(band => band.bottom)) + 12
      await expect.poll(async () => Math.abs((await box(pill(page))).top - expected)).toBeLessThanOrEqual(1)
      const where = await placement(page)
      const measured = JSON.stringify({pill: where.pill, stage: where.stage, bands})
      test.info().annotations.push({type: 'placement', description: measured})
      for (const band of bands) expect(overlaps(where.pill, band), `band ${measured}`).toBe(false)
      for (const control of where.controls) expect(overlaps(where.pill, control), JSON.stringify(control)).toBe(false)
      expect(Math.abs(where.pill.left + where.pill.width / 2 - (where.stage.left + where.stage.width / 2)), measured).toBeLessThanOrEqual(1)
      await expect(pill(page).getByRole('button', {name: 'Refresh'})).toBeVisible()
    })
  }
}
