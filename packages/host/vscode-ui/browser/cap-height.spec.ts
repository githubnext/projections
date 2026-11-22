import {test, expect, type Page} from '@playwright/test'
import {capGaps, expectCentred, withoutTextBox} from './cap.js'
import {ready, story} from './harness.js'

/**
 * Text in the chrome is centred by its cap height, not its line box: a capital "E" in the summary bar, in a figure's
 * pill and in a toolbar text button has the same space above, below and to its left (packages/host/vscode-ui/README.md). Measured
 * in pixels at 2× on a screenshot: the probe "E" replaces the label's text, and its ink is where the screenshot departs
 * from the container's background by half its peak contrast.
 */
const bar = (page: Page) => page.getByRole('group', {name: 'Summary'})

test.use({viewport: {width: 1280, height: 800}, deviceScaleFactor: 2})

for (const [theme, fallback] of [
  ['dark-modern', false],
  ['light-modern', false],
  ['dark-modern', true],
] as const) {
  test(`${theme}${fallback ? ', without text-box' : ''}: a capital E sits optically centred in the summary bar and in a hovered figure's pill`, async ({
    page,
  }) => {
    await page.goto(story('projection-view--summary-bar', theme))
    await ready(page)
    if (fallback) expect(await withoutTextBox(page)).toBeGreaterThan(0)
    await page.mouse.move(0, 0)
    const total = bar(page).locator('.phv-summary-figures [data-summary-total]').first()
    expectCentred(await capGaps(page, bar(page), total), 'bar')
    // The pill is drawn on hover.
    await total.hover()
    expectCentred(await capGaps(page, total, total), 'pill')
  })
}

test("a capital E sits optically centred in the toolbar's text buttons", async ({page}) => {
  // The "Showing table" chip, after its icon.
  await page.goto(story('projection-view--comparison', 'dark-modern', 'initialView:table'))
  await ready(page)
  const chip = page.locator('.phv-toolbar .phv-chip')
  expectCentred(await capGaps(page, chip, chip.locator('.phv-chip-text'), true), 'chip', true)
  // Narrow, the pair pickers merge into one action, "v1 → v2" after its icon.
  await page.setViewportSize({width: 380, height: 700})
  await page.goto(story('comparison-explorer--animated'))
  await ready(page)
  const pair = page.locator('.phv-toolbar .phv-pair-button').first()
  await pair.hover()
  expectCentred(await capGaps(page, pair, pair.locator('.phv-pair-button-text'), true), 'pair button', true)
})
