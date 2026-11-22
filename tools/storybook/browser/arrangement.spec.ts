import {test as base, expect} from '@playwright/test'
import type {Theme} from './smoke.spec.js'

const test = base.extend<{theme: Theme}>({theme: ['light', {option: true}]})

/**
 * Side by side arranges its two panes from the content's shape: a wide, short graph stacks them (Before above After,
 * each the full width), a tall or square one keeps them left and right, whichever fits the content larger. At this
 * viewport stacking wins above an aspect of about 1.3; these stories span roughly 0.4 to 1.8, so across them each
 * arrangement must be chosen at least once.
 */
const stories = ['graph', 'dag', 'architecture', 'infrastructure', 'dependencies', 'database']
const geometry = {band: 28, columnGap: 16, rowGap: 20, gutter: 18}
const viewport = {width: 1440, height: 1300}
/** `arrangementHysteresis` in the host's stage: how much larger the other arrangement must fit before a stage switches. */
const hysteresis = 1.15

for (const ui of ['default'] as const) {
  test(`${ui} UI: side by side stacks wide content and keeps tall content left and right, for the larger fit`, async ({
    page,
    theme,
  }, testInfo) => {
    test.skip(!['chromium-light', 'webkit-desktop'].includes(testInfo.project.name), 'the desktop projects cover the geometry')
    test.setTimeout(120_000)
    await page.setViewportSize(viewport)
    const chosen: string[] = []
    for (const story of stories) {
      await page.goto(
        new URL(
          `iframe.html?id=${ui}-ui-renderers--${story}&viewMode=story&globals=theme:${theme}&args=initialMode:side-by-side`,
          process.env.PROJECTIONS_STORYBOOK_URL,
        ).href,
      )
      const body = page.locator('.ph-stage-body.ph-panes').first()
      await expect(body).toHaveAttribute('data-content-aspect', /\d/u, {timeout: 30_000})
      // Settled: the arrangement holds for a moment.
      let previous = ''
      for (let attempt = 0; attempt < 20; attempt++) {
        const now = `${await body.getAttribute('data-stacked')}|${await body.getAttribute('data-content-aspect')}`
        if (now === previous) break
        previous = now
        await page.waitForTimeout(300)
      }
      const reading = await body.evaluate(element => {
        const box = element.getBoundingClientRect()
        const panes = [...element.querySelectorAll(':scope > section')].map(section => {
          const rect = section.getBoundingClientRect()
          return {side: section.getAttribute('data-side'), left: rect.left, top: rect.top}
        })
        return {
          width: element.clientWidth,
          height: box.height,
          aspect: Number(element.getAttribute('data-content-aspect')),
          stacked: element.hasAttribute('data-stacked'),
          panes,
        }
      })
      const fitted = (paneWidth: number, paneHeight: number) => Math.min(paneWidth, paneHeight * reading.aspect)
      const columns = fitted((reading.width - geometry.columnGap) / 2, reading.height - geometry.band)
      const stacked = fitted(reading.width - geometry.gutter, (reading.height - geometry.rowGap) / 2 - geometry.band)
      const label = `${story}: aspect ${reading.aspect}, columns ${columns.toFixed(0)}px, stacked ${stacked.toFixed(0)}px`
      // The chosen arrangement fits the content at the larger scale, or within the hysteresis that keeps a stage from
      // flipping (`arrangementHysteresis`) of the other when the content's shape is near the threshold.
      expect(reading.stacked ? stacked : columns, label).toBeGreaterThanOrEqual((reading.stacked ? columns : stacked) / hysteresis)
      const [before, after] = reading.panes
      expect([before!.side, after!.side]).toEqual(['before', 'after'])
      if (reading.stacked) expect(after!.top, `${story}: After is below Before`).toBeGreaterThan(before!.top)
      else expect(after!.left, `${story}: After is right of Before`).toBeGreaterThan(before!.left)
      chosen.push(reading.stacked ? 'stacked' : 'columns')
    }
    expect([...new Set(chosen)].toSorted(), `arrangements across ${stories.join(', ')}: ${chosen.join(', ')}`).toEqual([
      'columns',
      'stacked',
    ])
  })
}
