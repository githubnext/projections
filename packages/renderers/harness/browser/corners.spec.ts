import {expect, test} from '@playwright/test'
import type {CornerReport} from '@githubnext/projections-renderer-testing/playwright'
import {cornerReport, openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * Rounded corners, in pixels (see `cornerReport`): a bordered container's border keeps its thickness around each
 * curve, and nothing it holds paints over its border or outside its curve. Nested radii are concentric: a header band,
 * a last changed row or a card's change edge takes its container's radius less the inset.
 */
test.use({deviceScaleFactor: 2})

async function attachPictures(report: CornerReport, label: string) {
  for (const [name, url] of Object.entries(report.pictures ?? {}))
    await test.info().attach(`${label} ${name}.png`, {body: Buffer.from(url.split(',')[1]!, 'base64'), contentType: 'image/png'})
}

const cases = [
  {what: "a section's header band", scenario: 'runtime-policy/token-guard', selector: '.rp-panel', text: 'Network'},
  {what: 'a group ending in a changed line', scenario: 'text-diff/cli-output-release', selector: '.text-diff-command'},
  {what: "a workflow group's header band", scenario: 'agentic-workflows/docs-bot', selector: '.aw-group'},
  {what: "a card's change edge and status band", scenario: 'dependency-injection/nestjs-orders', selector: 'rect.node-emphasis-edge.added'},
] as const

for (const colorMode of ['light', 'dark'] as const) {
  for (const {what, scenario, selector, ...rest} of cases) {
    test(`${scenario}: ${what} keeps the border's corners whole (${colorMode})`, async ({page}, info) => {
      test.skip(!info.project.name.endsWith('desktop'), 'Corners measure the same at every width.')
      const stage = await openStage(page, harnessInspector(), {scenario, progress: 1, comparisonMode: 'diff', colorMode})
      await stage.measure('settle')
      let target = stage.frame.locator(selector)
      if ('text' in rest) target = target.filter({hasText: rest.text})
      const report = await cornerReport(page, target.first(), {label: selector})
      await attachPictures(report, selector)
      expect(report.corners.length, 'corners measured').toBeGreaterThan(0)
      expect(report.failures).toEqual([])
    })
  }
}

test('the report finds a square header band covering its group border', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'One engine shows the report reads the pictures.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'runtime-policy/token-guard', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  await stage.frame.locator('head').evaluate(head => {
    const style = document.createElement('style')
    style.textContent = '.pk .pk-group-header { border-radius: 0 !important }'
    head.append(style)
  })
  await stage.measure('settle')
  const report = await cornerReport(page, stage.frame.locator('.rp-panel').filter({hasText: 'Network'}).first())
  expect(report.failures.filter(failure => /^box top-(left|right) corner at 45°: the border is/.test(failure))).toHaveLength(2)
})
