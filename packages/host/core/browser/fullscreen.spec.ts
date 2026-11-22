import {test, expect} from '@playwright/test'
import {explorer, inToolbar} from './harness.js'

test('the full-screen fallback returns the page to where it was scrolled', async ({page}) => {
  // As on iPhone: no Fullscreen API, so the view becomes a fixed overlay, which shortens the page while it lasts.
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', {get: () => false})
    Object.defineProperty(Element.prototype, 'requestFullscreen', {value: undefined})
  })
  await page.goto(explorer())
  const root = page.locator('.ph')
  await expect(root).toHaveAttribute('data-renderer-status', /ready|none/u)
  await page.evaluate(() => {
    document.body.style.paddingBottom = '3000px'
    window.scrollTo(0, 425)
  })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(425)
  // On a phone, full screen is in the toolbar's More menu, which closes as it goes.
  const inline = await page.getByRole('button', {name: 'Enter full screen'}).isVisible()
  const enter = await inToolbar(page, scope => scope.getByRole('button', {name: 'Enter full screen'}))
  // Keyboard activation, so nothing scrolls the button into view.
  await enter.evaluate((button: HTMLElement) => button.focus({preventScroll: true}))
  await page.keyboard.press('Enter')
  await expect(root).toHaveAttribute('data-fullscreen', 'fallback')
  if (inline) {
    // The same button, now "Exit full screen", keeps focus; it leaves the overlay.
    await expect(page.getByRole('button', {name: 'Exit full screen'})).toBeFocused()
    await page.keyboard.press('Enter')
  } else await (await inToolbar(page, scope => scope.getByRole('button', {name: 'Exit full screen'}))).click()
  await expect(root).not.toHaveAttribute('data-fullscreen')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(425)
  // The button keeps focus without moving the page.
  if (inline) await expect(page.getByRole('button', {name: 'Enter full screen'})).toBeFocused()
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.scrollY)).toBe(425)
})
