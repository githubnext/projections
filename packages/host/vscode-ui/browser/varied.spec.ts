import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {ready, story} from './harness.js'

/**
 * Volatile variation in the VS Code UI, on the graph renderer's test-timings scenario: the summary bar's neutral
 * "2 varied within tolerance" toggle filters to the items that varied within tolerance, and the hover widget lists
 * each varied path with its values and tolerance.
 */
const frame = (page: Page) => page.locator('iframe.ph-frame').first().contentFrame()
const card = (page: Page) => page.locator('[data-detail-card]')
const toggle = (page: Page) => page.getByRole('button', {name: '2 varied within tolerance'})

test.use({viewport: {width: 1280, height: 800}})

for (const theme of ['light-modern', 'dark-modern'] as const)
  test(`${theme}: the varied count toggles a filter and the detail card lists varied paths`, async ({page}) => {
    await page.goto(story('projection-view--volatile-variation', theme))
    await ready(page)
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
    // Neutral: VS Code's description foreground, never a change hue.
    const colors = await toggle(page).evaluate(element => {
      const span = document.createElement('span')
      span.style.color = 'var(--vscode-descriptionForeground)'
      element.parentElement!.append(span)
      const muted = getComputedStyle(span).color
      span.remove()
      return {own: getComputedStyle(element).color, muted}
    })
    expect(colors.own).toBe(colors.muted)
    await expect(frame(page).locator('[data-entity-id="test:load"] [data-varied="beyond"]')).toHaveCount(1)
    await expect(frame(page).locator('[data-varied="beyond"]')).toHaveCount(1)

    await frame(page).locator('[data-entity-id="test:load"]').first().click()
    const beyond = card(page).locator('.phv-varied-field[data-varied-path="/data/durationMs"]')
    await expect(beyond).toHaveAttribute('data-within', 'false')
    await expect(beyond).toContainText('beyond tolerance (volatile)')
    expect(await beyond.locator('.phv-varied-values').evaluate(element => getComputedStyle(element).fontFamily)).toMatch(
      /mono|menlo|consolas|courier/i,
    )
    await page.keyboard.press('Escape')

    await toggle(page).click()
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
  })

test('the count sits at the end of the summary bar, never in the toolbar, at any width', async ({page}) => {
  await page.setViewportSize({width: 320, height: 800})
  await page.goto(story('projection-view--volatile-variation', 'light-modern'))
  await ready(page)
  await expect(page.locator('.phv-toolbar').getByRole('button', {name: /varied within tolerance/})).toHaveCount(0)
  const bar = page.getByRole('group', {name: 'Summary'})
  await bar.getByRole('button', {name: '2 varied within tolerance'}).click()
  await expect(bar.getByRole('button', {name: '2 varied within tolerance'})).toHaveAttribute('aria-pressed', 'true')
  expect(await bar.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
})
