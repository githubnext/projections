import {test as base, expect} from '@playwright/test'
import type {Theme} from './smoke.spec.js'

const test = base.extend<{theme: Theme}>({theme: ['light', {option: true}]})

/**
 * The default UI's prebuilt views fill the story canvas: a planned toolbar (never wrapped: one row, or in animated mode
 * a second row for playback with a full-width slider) and a stage that takes the rest. At 1440×900 and
 * on an iPhone 13 the stage takes at least 80% of the view's height.
 */
const stories = [
  'default-ui-comparison-explorer--animated',
  'default-ui-comparison-explorer--side-by-side',
  'default-ui-comparison-explorer--swipe',
  'default-ui-projection-view--comparison',
]
const sizes = [
  {name: '1440×900', width: 1440, height: 900},
  {name: 'iPhone 13', width: 390, height: 664},
] as const

for (const id of stories) {
  for (const {name, width, height} of sizes) {
    test(`${id} plans its toolbar rows and gives the stage at least 80% of the view's height at ${name}`, async ({page, theme}) => {
      await page.setViewportSize({width, height})
      await page.goto(new URL(`iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`, process.env.PROJECTIONS_STORYBOOK_URL).href)
      await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
      const measured = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
        const view = box('.ph')
        const stage = box('.ph-stage-body')
        const toolbar = document.querySelector('.ph-toolbar')!
        const rows = [...toolbar.querySelectorAll(':scope > .ph-toolbar-row')]
        const second = rows[1]
        return {
          height: stage.height / view.height,
          viewHeight: view.height,
          toolbarHeight: toolbar.getBoundingClientRect().height,
          rows: rows.length,
          // A second row holds only the playback group, its slider spanning the row.
          secondRow: second
            ? {
                playback: second.children.length === 1 && Boolean(second.querySelector('[aria-label="Comparison playback"]')),
                slider: second.querySelector('input[type="range"]')!.getBoundingClientRect().width / second.getBoundingClientRect().width,
              }
            : undefined,
          rowOverflow: toolbar.scrollWidth - toolbar.clientWidth,
          overflow: document.documentElement.scrollWidth - innerWidth,
          // No control overlaps another or leaves the toolbar.
          collisions: (() => {
            const bar = toolbar.getBoundingClientRect()
            const boxes = [...toolbar.querySelectorAll('button, select, input, output')]
              .map(element => element.getBoundingClientRect())
              .filter(rect => rect.width > 1 && rect.height > 1)
            let count = 0
            for (const [index, a] of boxes.entries()) {
              if (a.left < bar.left - 0.5 || a.right > bar.right + 0.5 || a.top < bar.top - 0.5 || a.bottom > bar.bottom + 0.5) count++
              for (const b of boxes.slice(index + 1)) {
                if (
                  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
                  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
                ) {
                  count++
                }
              }
            }
            return count
          })(),
        }
      })
      expect(measured.overflow).toBeLessThanOrEqual(0)
      expect(measured.rowOverflow).toBeLessThanOrEqual(0)
      expect(measured.collisions).toBe(0)
      // Only animated playback may take a second row: below a centred mode region, or where one row would collapse too far.
      const animated = id.endsWith('--animated') || id.endsWith('--comparison')
      expect(measured.rows).toBeLessThanOrEqual(animated ? 2 : 1)
      if (measured.secondRow) {
        expect(measured.secondRow.playback).toBe(true)
        expect(measured.secondRow.slider).toBeGreaterThanOrEqual(0.8)
      }
      expect(measured.toolbarHeight).toBeLessThanOrEqual(measured.rows === 2 ? 84 : 48)
      // The view takes the canvas height, less the frame's padding.
      expect(measured.viewHeight).toBeGreaterThan(height * 0.85)
      expect(measured.height).toBeGreaterThanOrEqual(0.8)
    })
  }
}
