import {expect, test} from '@playwright/test'
import {type CornerReport, cornerReport, openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'
import {scenarios} from './scenarios.js'

/**
 * Every built-in renderer's kit frames keep their borders whole around their corners, in pixels: a `Group` (which draws
 * its border again over its contents) and a data table (whose frame draws its top again outside its scroll box). Each
 * corner's arc, its thickness averaged around the curve, stays within 93% to 160% of its sides': a fill or a clip
 * against the curve, even concentric with it, dilutes the border's antialiased pixels and thins it, which only a border
 * painted over its contents, outside any clip, avoids. And nothing between a frame and a change run inside it forms a
 * stacking context, or the run's edge (above the frame's, so the change's hue wins its line) sinks under it.
 */
test.use({deviceScaleFactor: 2})

const frames = [
  {selector: '.pk-group:not(:has(> .pk-table-frame))', options: {}},
  {selector: '.pk-table-scroll', options: {frame: 1}},
] as const
/** Frames measured per kind and scenario: the first ones, as a renderer draws every one alike. */
const perScenario = 4

async function attachPictures(report: CornerReport, label: string) {
  for (const [name, url] of Object.entries(report.pictures ?? {})) {
    await test
      .info()
      .attach(`${label} ${name}.png`, {body: Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'), contentType: 'image/png'})
  }
}

for (const {key} of scenarios) {
  test(`${key}: frames keep their borders whole around their corners, above their contents`, async ({page}, info) => {
    test.skip(!info.project.name.endsWith('desktop'), 'Corners measure the same at every width.')
    test.slow()
    const failures: string[] = []
    let measured = 0
    for (const colorMode of ['light', 'dark'] as const) {
      const stage = await openStage(page, harnessInspector(), {scenario: key, progress: 1, comparisonMode: 'diff', colorMode})
      await stage.measure('settle')
      if (colorMode === 'light') {
        failures.push(
          ...(await stage.frame.locator('body').evaluate(body => {
            // What makes a stacking context, besides the root's: enough for the renderers' CSS.
            const stacks = (element: Element) => {
              const style = getComputedStyle(element)
              return (
                (style.position !== 'static' && style.zIndex !== 'auto') ||
                style.isolation === 'isolate' ||
                Number(style.opacity) < 1 ||
                style.transform !== 'none' ||
                style.filter !== 'none' ||
                style.mixBlendMode !== 'normal' ||
                /paint|layout|strict|content/u.test(style.contain)
              )
            }
            const found: string[] = []
            for (const run of body.querySelectorAll('.pk-group .pk-region-run[data-change]')) {
              const frame = run.closest('.pk-group')
              for (let element = run.parentElement; element && element !== frame; element = element.parentElement) {
                if (stacks(element)) {
                  found.push(
                    `${element.tagName.toLowerCase()}.${String(element.getAttribute('class')).replaceAll(' ', '.')} forms a stacking context between a change run and its frame`,
                  )
                }
              }
            }
            return [...new Set(found)]
          })),
        )
      }
      for (const {selector, options} of frames) {
        const all = stage.frame.locator(selector)
        const count = Math.min(await all.count(), perScenario)
        for (let index = 0; index < count; index++) {
          const label = `${colorMode} ${selector}#${index}`
          const report = await cornerReport(page, all.nth(index), {label, contrast: 6, minRatio: 0.93, ...options})
          measured += report.corners.length
          failures.push(...report.failures)
          await attachPictures(report, label)
        }
      }
    }
    if (!measured) test.skip(true, 'No frames with rounded, bordered corners.')
    expect(failures).toEqual([])
  })
}

// Main's construction before the frame (a header band at the inner radius, concentric, and no edge drawn over it) on
// runtime-policy's Policies card, and the table's (its heading drawing the top, clipped to the curve): the arcs thin.
for (const {what, scenario, selector, options, css} of [
  {
    what: 'a group',
    scenario: 'runtime-policy/token-guard',
    selector: '.rp-panel',
    options: {},
    css: '.pk .pk-group::after { content: none !important }',
  },
  {
    what: 'a data table',
    scenario: 'code-statistics/gateway-table',
    selector: '.pk-table-scroll',
    options: {frame: 1},
    css: '.pk .pk-table-frame::before { content: none !important } .pk .pk-table-head { border-top-color: var(--pk-table-line) !important }',
  },
]) {
  test(`without its edge drawn over its contents, ${what}'s corners thin, and the check says so`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium-desktop', 'One engine shows the check reads the thinning.')
    const stage = await openStage(page, harnessInspector(), {scenario, progress: 1, comparisonMode: 'diff', colorMode: 'dark'})
    await stage.measure('settle')
    await stage.frame.locator('head').evaluate((head, without) => {
      const style = document.createElement('style')
      style.textContent = without
      head.append(style)
    }, css)
    await stage.measure('settle')
    const report = await cornerReport(page, stage.frame.locator(selector).first(), {contrast: 6, minRatio: 0.93, ...options})
    expect(
      report.failures.some(failure => /top-(?:left|right) corner: the border is [\d.]+ px around the curve, under/u.test(failure)),
    ).toBe(true)
  })
}
