import {test, expect, type Page} from '@playwright/test'
import {expectNoFlash, frameReport, resetCreated, watchFrames} from './flash-check.js'
import {chooseMode, explorer, pairSelect} from './harness.js'

// The pixel sampler takes hundreds of screenshots; a trace of them would fill a CI runner's disk.
test.use({trace: 'off'})

const view = (page: Page) => page.locator('.ph')

async function open(page: Page, query: string) {
  await page.goto(explorer(query))
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  await expect(view(page)).toHaveAttribute('data-color-mode', 'dark')
}

async function switchTo(page: Page, name: string, value: string) {
  await chooseMode(page, name)
  await expect(view(page)).toHaveAttribute('data-comparison-mode', value)
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
}

test.use({colorScheme: 'dark'})

for (const renderer of ['auto', 'minimal']) {
  test(`switching comparison modes never shows an unpainted or light frame (${renderer} renderer)`, async ({page}) => {
    test.slow()
    await open(page, `before=v1&after=v3&renderer=${renderer}`)
    await watchFrames(page)
    await expectNoFlash(page, async () => {
      // Entering side by side loads only the before frame; the animated frame becomes the after pane.
      await resetCreated(page)
      await switchTo(page, 'Side by side', 'side-by-side')
      // The mode and status attributes can settle before the frame watcher's next animation frame sees the new frame.
      await expect(page.locator('iframe.ph-frame')).toHaveCount(2)
      await expect.poll(async () => (await frameReport(page)).created).toBe(1)
      await resetCreated(page)
      await switchTo(page, 'Swipe', 'swipe')
      await switchTo(page, 'Animated', 'animated')
      expect((await frameReport(page)).created).toBe(0)
      // Rapid switching.
      for (let round = 0; round < 3; round++) {
        await chooseMode(page, 'Side by side')
        await chooseMode(page, 'Swipe')
        await chooseMode(page, 'Animated')
      }
      await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
      // Another pair reuses the frame.
      await resetCreated(page)
      await (await pairSelect(page, 'To')).selectOption('v2')
      await expect(view(page)).toHaveAttribute('data-rendered-progress', '1')
      expect((await frameReport(page)).created).toBe(0)
    })
  })
}

test('a renderer switch and a theme change never show an unpainted frame', async ({page}) => {
  test.slow()
  await open(page, 'before=v1&after=v3')
  await watchFrames(page)
  await expectNoFlash(page, async () => {
    await page.locator('.demo-controls').getByLabel('Renderer').selectOption('minimal')
    await expect(page.locator('.ph-frame-host')).toHaveAttribute('data-renderer', 'minimal')
    await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
    await switchTo(page, 'Side by side', 'side-by-side')
  })
  await page.locator('.demo-controls').getByLabel('Theme').selectOption('light')
  await expect(view(page)).toHaveAttribute('data-color-mode', 'light')
  await page.locator('.demo-controls').getByLabel('Theme').selectOption('dark')
  await expect(view(page)).toHaveAttribute('data-color-mode', 'dark')
  expect((await frameReport(page)).violations).toEqual([])
})

test('a frame stays transparent behind the host loading status until the renderer paints', async ({page}) => {
  // The silent probe never acknowledges painting.
  await page.goto(explorer('renderer=hostile&probe=silent'))
  const frame = page.locator('iframe.ph-frame')
  await expect(frame).toHaveAttribute('data-revealed', 'false')
  await expect(frame).toHaveCSS('opacity', '0')
  await expect(frame).toHaveCSS('color-scheme', 'light dark')
  expect(new URL((await frame.getAttribute('src'))!).hash).toContain('color=dark')
  await expect(page.getByRole('status').filter({hasText: /Loading the .* renderer/u})).toBeVisible()
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'loading')
})
