import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {story} from './harness.js'

/**
 * Swipe's divider is one control: its 1px line takes the thumb's outline color, and both change together on hover,
 * drag and keyboard focus. Side by side keeps its neutral pane edges.
 */
const view = (page: Page) => page.locator('.ph').first()
const line = (page: Page) => page.locator('.ph-swipe-line')
const thumb = (page: Page) => page.locator('.ph-swipe-thumb')
const grab = (page: Page) => page.locator('.ph-swipe-grab')
const colors = async (page: Page) => ({
  line: await line(page).evaluate(element => getComputedStyle(element).backgroundColor),
  outline: await thumb(page).evaluate(element => getComputedStyle(element).borderTopColor),
  width: await line(page).evaluate(element => element.getBoundingClientRect().width),
  fill: await thumb(page).evaluate(element => getComputedStyle(element).backgroundColor),
})

test.use({viewport: {width: 1280, height: 800}})

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: the swipe line is the thumb's outline color, 1px, at rest, on hover, while dragged and under focus`, async ({page}) => {
    await page.goto(story('default-ui-comparison-explorer--swipe', `globals=theme:${theme}`))
    await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready', {timeout: 30_000})
    const rest = await colors(page)
    expect(rest.line).toBe(rest.outline)
    expect(rest.width).toBe(1)
    const box = (await grab(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 40)
    const hover = await colors(page)
    expect(hover.line).toBe(hover.outline)
    // Pointed at, the thumb fills: the cue that it can be dragged, whatever the theme's colors.
    expect(hover.fill).not.toBe(rest.fill)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + 40)
    await expect(page.locator('.ph-swipe-handle')).toHaveAttribute('data-dragging', 'true')
    const drag = await colors(page)
    expect(drag.line).toBe(drag.outline)
    await page.mouse.up()
    await page.mouse.move(5, 5)
    await expect(page.locator('.ph-swipe-handle')).not.toHaveAttribute('data-dragging', /./u)
    await page.getByRole('slider', {name: 'Comparison divider'}).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.ph-swipe-handle')).toHaveAttribute('data-focus-visible', 'true')
    const focus = await colors(page)
    expect(focus.line).toBe(focus.outline)
    expect((await colors(page)).width).toBe(1)
  })
}
