import {expect, test} from '@playwright/test'
import {openStage, type OffCentreLabel} from '@githubnext/projections-renderer-testing/playwright'
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
