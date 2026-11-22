import {expect, test} from '@playwright/test'
import {openStage, type OffCentreLabel} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

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
