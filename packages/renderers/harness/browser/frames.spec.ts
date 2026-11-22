import {expect, test} from '@playwright/test'
import {type CornerReport, type CoveredFrame, cornerReport, openStage} from '@githubnext/projections-renderer-testing/playwright'
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

// The `frame-edges` check's probe, on the gallery's scenario stage: a rounded, bordered box its note and nested drawing
// fill to its edge. As a kit frame its border is drawn over them; as it was before (its own border, clipping them
// itself), they are painted over it, and the probe finds it.
test("the frame-edges probe finds a stage filled over its rounded edge, and none once it is the kit's frame", async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'The probe reads computed styles, the same in every engine.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'gallery/fixture-change', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  const stages = async () => (await stage.measure<CoveredFrame[]>('frames')).filter(found => found.element.startsWith('div.gl-stage'))
  expect(await stages()).toEqual([])
  await stage.frame.locator('.gl-stage').evaluateAll(all => {
    for (const element of all) {
      element.classList.remove('pk-frame')
      if (element instanceof HTMLElement) {
        element.style.position = 'relative'
        element.style.overflow = 'hidden'
        element.style.borderRadius = 'var(--projections-radius-sm)'
      }
    }
  })
  expect((await stages()).length).toBeGreaterThan(0)
})

// A kit frame's `::after` is its edge: a renderer's rule drawing there (a badge, a label) loses to the kit's, or moves
// the edge. The probe finds such a rule; one that only recolors the edge is fine.
test("the frame-edges probe finds a rule drawing in a kit frame's ::after, and lets one recolor its edge", async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'The probe reads stylesheets, the same in every engine.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'gallery/fixture-change', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  const claimed = async () => (await stage.measure<CoveredFrame[]>('frames')).filter(found => found.rule !== undefined)
  expect(await claimed()).toEqual([])
  const add = (css: string) =>
    stage.frame.locator('head').evaluate((head, text) => {
      const style = document.createElement('style')
      style.textContent = text
      head.append(style)
    }, css)
  await add('.gl-stage::after { border-color: var(--projections-color-accent) }')
  expect(await claimed()).toEqual([])
  await add(".gl-stage::after { content: 'New'; background: var(--projections-color-accent) }")
  expect((await claimed()).map(found => found.rule)).toEqual(
    expect.arrayContaining([expect.stringMatching(/^\.gl-stage::after \{ content, background/u)]),
  )
})

// The probe's edge cases: modern transparent colors, inset shadows that draw no edge, fitted pill radii, a nested
// renderer's frame, and overlays that can't draw over a fill.
test('the frame-edges probe reads transparency, shadows, fitted radii, frames and overlay stacking', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'The probe reads computed styles, the same in every engine.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'gallery/fixture-change', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  await stage.frame.locator('.pk').evaluate(root => {
    const probe = document.createElement('div')
    const box = 'width: 160px; height: 60px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin: 8px'
    const fill = 'display: block; width: 100%; height: 100%; background: var(--band)'
    probe.innerHTML = `
      <style>
        .fe-under, .fe-faded { position: relative; isolation: isolate; }
        .fe-under::after, .fe-faded::after { content: ''; position: absolute; inset: -1px; border: 1px solid var(--border); border-radius: inherit; }
        .fe-under::after { z-index: -1; }
        .fe-under > span { position: relative; z-index: 1; }
        .fe-faded::after { opacity: 0; }
      </style>
      <div class="fe-clear" style="${box}; border-color: color(srgb 0 0 0 / 0)"><span style="${fill}"></span></div>
      <div class="fe-shadow" style="${box}"><span style="${fill}; box-shadow: inset 0 0 0 1px transparent"></span></div>
      <div class="fe-pill" style="${box}; height: 40px; border-radius: 9999px"><span style="${fill}"></span></div>
      <div class="fe-frame" style="${box}"><iframe style="display: block; width: 100%; height: 100%; border: 0" srcdoc="<p>nested</p>"></iframe></div>
      <div class="fe-under" style="${box}"><span style="${fill}"></span></div>
      <div class="fe-faded" style="${box}"><span style="${fill}"></span></div>`
    root.prepend(probe)
  })
  const found = (await stage.measure<CoveredFrame[]>('frames')).map(frame => frame.element).filter(element => element.includes('.fe-'))
  expect(found.toSorted()).toEqual(['div.fe-faded', 'div.fe-frame', 'div.fe-pill', 'div.fe-shadow', 'div.fe-under'])
})
