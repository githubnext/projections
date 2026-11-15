import {expect} from '@playwright/test'
import type {FrameLocator, Page} from '@playwright/test'

/**
 * Records, in every document of the page (the renderer frame's among them), each scale the element matching
 * `selector` carries as `data-scale` before each frame is painted: every scale a person could have seen.
 */
export async function recordPaintedScales(page: Page, selector: string): Promise<void> {
  await page.context().addInitScript(target => {
    const painted: string[] = []
    Object.assign(window, {paintedScales: painted})
    const record = () => {
      const scale = document.querySelector(target)?.getAttribute('data-scale')
      if (scale && Number(scale) > 0 && painted.at(-1) !== scale) painted.push(scale)
      requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  }, selector)
}

/** The scales the renderer frame painted, once the host has finished growing the frame to the height it asked for. */
export async function paintedScales(page: Page, frame: FrameLocator): Promise<{height: number; scales: string[]}> {
  const element = page.locator('iframe.ph-frame').first()
  let height = 0
  await expect
    .poll(
      async () => {
        const now = (await element.boundingBox())?.height ?? 0
        const held = now === height
        height = now
        return held
      },
      {intervals: [250]},
    )
    .toBe(true)
  const scales = await frame.locator('body').evaluate(() => (window as unknown as {paintedScales: string[]}).paintedScales)
  return {height, scales}
}
