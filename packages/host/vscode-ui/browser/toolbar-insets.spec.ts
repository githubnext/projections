import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {expectEdgeInsets, toolbarInsets} from './cap.js'
import {ready, story} from './harness.js'

/**
 * The toolbar's edge controls sit as far from its ends as from its top and bottom (packages/host/vscode-ui/README.md, "Building
 * blocks"): the leading control (the mode group, a picker) has the same space to its left as above and below it, and
 * the trailing control the same to its right, inside the toolbar's bottom hairline. The playback row, under its own
 * hairline, holds to the same rule. Measured on border boxes, in every mode and as the toolbar collapses. A tab's start
 * slot (`tabStart`) draws nothing for an ordinary result, and leaves no gap.
 */
const regions = '.phv-toolbar-start, .phv-toolbar-mode, .phv-toolbar-end, .phv-actions, .phv-pair-picker, .phv-pair-field, .tp-pair'
const measure = (page: Page) =>
  toolbarInsets(page.locator('.phv-toolbar').first(), {
    wrappers: regions,
    secondRow: '.phv-playback',
  })

for (const width of [1280, 600, 400, 320]) {
  for (const mode of ['side-by-side', 'animated', 'diff'] as const) {
    test(`at ${width}px, ${mode}: a VS Code tab's toolbar insets its edge controls as far from its ends as from its top and bottom`, async ({
      page,
    }) => {
      await page.setViewportSize({width, height: 700})
      await page.goto(story('projection-view--comparison', 'dark-modern', `tabStart:!true;initialMode:${mode}`))
      await ready(page)
      expectEdgeInsets(await measure(page), `tab at ${width}px, ${mode}`)
      // Row 1 is the tab's skeleton strip (packages/integrations/vscode/src/html.ts): 35px, hairline included. Animated
      // playback has a second row of its own below that hairline.
      const toolbar = page.locator('.phv-toolbar').first()
      const height = (await toolbar.boundingBox())!.height
      if (mode !== 'animated') expect(height).toBe(35)
      else {
        const top = (await toolbar.boundingBox())!.y
        expect((await toolbar.locator(':scope > .phv-playback').boundingBox())!.y - top).toBe(34)
        expect(height).toBeGreaterThan(35)
      }
    })
  }
}

for (const width of [1280, 600, 400, 320]) {
  for (const mode of ['animated', 'side-by-side'] as const) {
    test(`at ${width}px, ${mode}: the explorer's toolbar, its pair pickers leading, insets its edge controls alike`, async ({page}) => {
      await page.setViewportSize({width, height: 700})
      await page.goto(story(`comparison-explorer--${mode}`))
      await ready(page)
      expectEdgeInsets(await measure(page), `explorer at ${width}px, ${mode}`)
      // A pair field is its dropdown's height with any font: no line box around it adds the font's descent.
      for (const field of await page.locator('.phv-toolbar .phv-pair-field').all()) {
        const [outer, inner] = await Promise.all([field.boundingBox(), field.locator('vscode-single-select').boundingBox()])
        if (outer && inner) expect(outer.height, `explorer at ${width}px, ${mode}: a pair field's height`).toBe(inner.height)
      }
    })
  }
}
