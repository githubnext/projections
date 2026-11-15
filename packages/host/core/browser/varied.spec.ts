import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {showAs, story} from './harness.js'

/**
 * Volatile variation (docs/guides/host.md "Volatile variation"), on the graph renderer's test-timings scenario: two tests
 * varied within tolerance (unchanged), one slowed beyond it (modified), compared in the browser with the
 * test-timings comparator. The summary bar counts the varied items as a neutral toggle that filters to them, the detail
 * card lists each varied path with its values and tolerance, and the renderer marks only the change beyond tolerance.
 */
const view = (page: Page) => page.locator('.ph').first()
const frame = (page: Page) => page.locator('iframe.ph-frame').first().contentFrame()
const card = (page: Page) => page.locator('[data-detail-card]')
const toggle = (page: Page) => page.getByRole('button', {name: '2 varied within tolerance'})

async function open(page: Page) {
  await page.goto(story('default-ui-projection-view--volatile-variation'))
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready', {timeout: 30_000})
}

test.use({viewport: {width: 1280, height: 800}})

test('the summary bar counts the items that varied within tolerance, neutrally, and the toggle shows only them', async ({page}) => {
  await open(page)
  await expect(toggle(page)).toBeVisible()
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false')
  // Neutral: the muted foreground, the same as the toolbar's own secondary text, never a change color.
  const colors = await toggle(page).evaluate(element => {
    const probe = (name: string) => {
      const span = document.createElement('span')
      span.style.color = `var(${name})`
      element.closest('.ph')!.append(span)
      const color = getComputedStyle(span).color
      span.remove()
      return color
    }
    return {
      own: getComputedStyle(element).color,
      muted: probe('--pj-muted-foreground'),
      changes: ['--projections-color-added', '--projections-color-removed', '--projections-color-modified'].map(probe),
    }
  })
  expect(colors.own).toBe(colors.muted)
  expect(colors.changes).not.toContain(colors.own)

  await toggle(page).click()
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true')
  await showAs(page, 'Table')
  await expect(page.locator('.ph-table-view tr[data-row-id]')).toHaveCount(2)
  await expect(page.locator('.ph-table-view tr[data-row-id="test:parse"]')).toHaveCount(1)
  await expect(page.locator('.ph-table-view tr[data-row-id="test:emit"]')).toHaveCount(1)
  await toggle(page).click()
  await expect(page.locator('.ph-table-view tr[data-row-id]')).not.toHaveCount(2)
})

test('the renderer marks only the change beyond tolerance, and items that varied within it stay neutral', async ({page}) => {
  await open(page)
  const markers = frame(page).locator('[data-varied="beyond"]')
  await expect(markers).toHaveCount(1)
  await expect(frame(page).locator('[data-entity-id="test:load"] [data-varied="beyond"]')).toHaveCount(1)
  await expect(frame(page).getByRole('img', {name: 'Volatile field changed beyond tolerance'})).toHaveCount(1)
  for (const id of ['test:parse', 'test:emit']) {
    const item = frame(page).locator(`[data-entity-id="${id}"]`).first()
    await expect(item).not.toHaveAttribute('data-change', /./)
    await expect(item.locator('[data-change-status], [data-varied]')).toHaveCount(0)
  }
})

test('the detail card lists each varied path with its values and tolerance, in the monospace font', async ({page}) => {
  await open(page)
  await frame(page).locator('[data-entity-id="test:load"]').first().click()
  const beyond = card(page).locator('.ph-varied-field[data-varied-path="/data/durationMs"]')
  await expect(beyond).toHaveAttribute('data-within', 'false')
  await expect(beyond).toContainText('durationMs')
  await expect(beyond).toContainText('100')
  await expect(beyond).toContainText('400')
  await expect(beyond).toContainText('beyond tolerance (volatile)')
  for (const selector of ['.ph-field-name', '.ph-varied-values'])
    expect(await beyond.locator(selector).evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/mono/i)
  // Listed as a volatile value, not as a changed field.
  await expect(card(page).locator('[data-field="data:durationMs"]')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await frame(page).locator('[data-entity-id="test:parse"]').first().click()
  const within = card(page).locator('.ph-varied-field[data-varied-path="/data/durationMs"]')
  await expect(within).toHaveAttribute('data-within', 'true')
  await expect(within).toContainText('within tolerance')
  await expect(card(page).locator('.ph-change-pill')).toHaveCount(0)
})

test('the count sits at the end of the summary bar, never in the toolbar, at any width', async ({page}) => {
  await page.setViewportSize({width: 420, height: 800})
  await open(page)
  await expect(page.locator('.ph-toolbar .ph-varied-toggle')).toHaveCount(0)
  const bar = page.getByRole('group', {name: 'Summary'})
  await expect(bar.getByRole('button', {name: '2 varied within tolerance'})).toBeVisible()
  await bar.getByRole('button', {name: '2 varied within tolerance'}).click()
  await expect(bar.getByRole('button', {name: '2 varied within tolerance'})).toHaveAttribute('aria-pressed', 'true')
  expect(await bar.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
})
