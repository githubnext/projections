import {expect, test} from '@playwright/test'
import {openStage, type OffCentreLabel, type OffPixelChild} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'
import {scenarios} from './scenarios.js'

const scenarioKeys = scenarios.map(scenario => scenario.key)

/**
 * Labels centred on their capitals: the kit's `pk-label` trims a label's text box to its capitals and baseline and pads
 * it back to its line height. The renderer checks hold every scenario to it (`label-centring`); this case shows the
 * probe finds the labels a line box leaves off centre, by undoing the trim, as before the rule.
 */
test('the label-centring probe finds labels a line box leaves off centre, and none with pk-label', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'One engine shows the probe works; the checks run in every one.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'runtime-policy/deployment', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  expect(await stage.measure<OffCentreLabel[]>('labels')).toEqual([])
  await stage.frame.locator('head').evaluate(head => {
    const style = document.createElement('style')
    style.textContent = '.pk .pk-label.pk-label { text-box: none !important; padding-block: var(--pk-label-inset, 0px) !important }'
    head.append(style)
  })
  await stage.measure('settle')
  // Which labels a line box leaves off centre depends on the fonts' metrics; some always are.
  expect((await stage.measure<OffCentreLabel[]>('labels')).length).toBeGreaterThan(0)
})

/**
 * A label's box is its line height, so a pill, band or row it sizes is as tall as before it was trimmed: the text box
 * is trimmed to the font's capitals and padded back by its cap height (`1cap`). An engine trimming to other capitals
 * than `1cap` measures would leave every such box, and the frames around them, a fraction of a pixel off.
 */
test("a one-line label's box is its line height, in every scenario", async ({page}) => {
  test.setTimeout(300_000)
  const off: string[] = []
  for (const key of scenarioKeys) {
    const stage = await openStage(page, harnessInspector(), {scenario: key, progress: 1, comparisonMode: 'diff'})
    await stage.measure('settle')
    const found = await stage.frame.locator('.pk-label').evaluateAll(labels =>
      labels.flatMap(label => {
        const style = getComputedStyle(label)
        if (style.getPropertyValue('text-box-trim') !== 'trim-both' || style.display === 'inline') return []
        const lineHeight = Number.parseFloat(style.lineHeight)
        // Its line height and inset, resolved: the least it may be.
        const expected = Number.parseFloat(style.minHeight)
        const height = label.getBoundingClientRect().height
        // One line: less than a line taller than that.
        if (!lineHeight || !expected || height > expected + 0.5 * lineHeight) return []
        return Math.abs(height - expected) > 0.05
          ? [
              `${label.getAttribute('class') ?? ''} (${style.fontFamily.split(',')[0]} ${style.fontSize}): ${height.toFixed(3)}px, not ${expected}px`,
            ]
          : []
      }),
    )
    off.push(...[...new Set(found)].map(line => `${key}: ${line}`))
  }
  expect(off).toEqual([])
})

// A renderer that fits its drawing with a transform (database scales its content) draws its labels scaled: they are
// measured in their own laid-out pixels, so a centred label stays centred at any scale.
test('the label-centring probe measures labels drawn scaled as laid out', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'One engine shows the probe works; the checks run in every one.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'runtime-policy/deployment', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  expect(await stage.measure<OffCentreLabel[]>('labels')).toEqual([])
  await stage.frame.locator('.pk').evaluate(root => {
    for (const child of root.children) if (child instanceof HTMLElement) child.style.transform = 'scale(0.6)'
  })
  expect(await stage.measure<OffCentreLabel[]>('labels')).toEqual([])
})

// Words with a code span in them are prose, not an identifier: the label keeps the UI font (only a ValueChange marked
// `code` sets its values in the monospace font).
test('a label of mixed prose keeps the UI font around its code', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'Computed fonts, the same in every engine.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'runtime-policy/deployment', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  const fonts = await stage.frame.locator('.pk').evaluate(root => {
    const probe = document.createElement('span')
    probe.className = 'pk-label'
    probe.innerHTML = 'Using <code class="pk-code" data-projections-identifier="">cache</code> now'
    root.prepend(probe)
    const code = probe.querySelector('code') ?? probe
    return {label: getComputedStyle(probe).fontFamily, code: getComputedStyle(code).fontFamily, ui: getComputedStyle(root).fontFamily}
  })
  expect(fonts.label).toBe(fonts.ui)
  expect(fonts.code).not.toBe(fonts.ui)
  // And in the scenario's own warning notes, which are such prose.
  const notes = await stage.frame
    .locator('.rp-warning > .pk-label')
    .evaluateAll(labels => labels.map(label => getComputedStyle(label).fontFamily))
  expect(notes.length).toBeGreaterThan(0)
  expect(new Set(notes)).toEqual(new Set([fonts.ui]))
})

/**
 * Centred on whole pixels: a label's line box is rounded up to a whole pixel and icons are even squares, so
 * a band's icon centres at whole gaps. Undone (a 13px icon, a 19.5px line), the probe finds it off them.
 */
test('the centred-pixels probe finds an icon a half pixel off in its band, and none with even room', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'One engine shows the probe works; the checks run in every one.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'runtime-policy/deployment', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  expect(await stage.measure<OffPixelChild[]>('pixels')).toEqual([])
  await stage.frame.locator('head').evaluate(head => {
    const style = document.createElement('style')
    style.textContent =
      '.pk [data-icon] { width: 1em !important; height: 1em !important } .pk .pk-label.pk-label { min-height: calc(1lh + 2 * var(--pk-label-inset, 0px)) !important; padding-block: calc((1lh - 1cap) / 2 - 0.5px + var(--pk-label-inset, 0px)) !important }'
    head.append(style)
  })
  await stage.measure('settle')
  const found = (await stage.measure<OffPixelChild[]>('pixels')).map(child => `${child.element} in ${child.holder}`)
  expect(found).toEqual(expect.arrayContaining([expect.stringMatching(/^span\.pk-icon in header\.pk-group-header/u)]))
})

/**
 * What the centred-pixels probe holds and how it measures: an image is a box though it's inline; a box inside an
 * invisible container isn't seen; a collapsed table cell's room is inside half of each rule it shares, the one under it
 * drawn by the cell below it, not the next row's widest.
 */
test('the centred-pixels probe sees inline images, skips invisible boxes and measures collapsed cells inside half their rules', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'One engine shows the probe works; the checks run in every one.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'runtime-policy/deployment', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  await stage.frame.locator('body').evaluate(body => {
    const fixture = document.createElement('div')
    const square = (size: number, name: string) =>
      `<span class="${name}" style="display:block;margin:auto;width:${size}px;height:${size}px;background:#333"></span>`
    const cell = (style: string, content = '') => `<td style="border:1px solid #888;padding:0;${style}">${content}</td>`
    fixture.innerHTML = `
      <div style="opacity:0"><div style="display:flex;align-items:center;width:32px;height:32px;background:#eee">${square(13, 'px-hidden')}</div></div>
      <div style="width:32px;height:32px;background:#eee;text-align:center;line-height:0"><img class="px-image" width="13" height="13" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div>
      <table style="border-collapse:collapse;border-spacing:0">
        <tr>${cell('width:32px;height:33px', square(14, 'px-cell'))}${cell('width:32px;height:33px')}</tr>
        <tr>${cell('height:8px')}${cell('height:8px;border-top-width:3px')}</tr>
      </table>`
    fixture.style.cssText = 'position:absolute;top:0;left:0;z-index:10;background:#fff'
    body.append(fixture)
  })
  const found = (await stage.measure<OffPixelChild[]>('pixels')).map(child => `${child.element} ${child.axis}`)
  expect(found).toEqual(['img.px-image horizontal'])
})
