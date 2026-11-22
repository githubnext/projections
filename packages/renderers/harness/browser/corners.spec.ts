import {expect, test} from '@playwright/test'
import {type CornerReport, cornerReport, openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * Rounded corners, in pixels (see `cornerReport`): a bordered container's border keeps its thickness around each
 * curve, and nothing it holds paints over its border or outside its curve. Nested radii are concentric: a header band,
 * a last changed row or a card's change edge takes its container's radius less the inset.
 */
test.use({deviceScaleFactor: 2})

async function attachPictures(report: CornerReport, label: string) {
  for (const [name, url] of Object.entries(report.pictures ?? {})) {
    await test.info().attach(`${label} ${name}.png`, {body: Buffer.from(url.split(',')[1]!, 'base64'), contentType: 'image/png'})
  }
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

/**
 * Table frames: a data table's frame, which its heading and rows draw (`frame`: the line's width), and a database
 * card's, its inset outline over its header band and rows; each at rest, then with the row in its bottom corners (or
 * its first row) selected and hovered, whose ring and hue reach those corners.
 */
const tables = [
  {what: "a data table's frame", scenario: 'code-statistics/gateway-table', selector: '.pk-table-scroll', frame: 1, rows: '.pk-table-row'},
  {
    what: "a database table's card",
    scenario: 'database/prisma-shop',
    selector: '.database-table:not(.database-enum-card):has(> header)',
    rows: '.database-column[data-entity-id]',
  },
] as const

for (const colorMode of ['light', 'dark'] as const) {
  for (const {what, scenario, selector, rows, ...rest} of tables) {
    test(`${scenario}: ${what} keeps its corners whole at rest, selected and hovered (${colorMode})`, async ({page}, info) => {
      test.skip(!info.project.name.endsWith('desktop'), 'Corners measure the same at every width.')
      const stage = await openStage(page, harnessInspector(), {scenario, progress: 1, comparisonMode: 'diff', colorMode})
      await stage.measure('settle')
      const target = stage.frame.locator(selector).first()
      const options = {label: selector, ...('frame' in rest ? {frame: rest.frame} : {})}
      const ids = await target.evaluate((element, rowSelector) => {
        const all = [...element.querySelectorAll(rowSelector)].filter(row => row.getAttribute('data-entity-id'))
        const bottom = [...all].sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)
        return [...new Set([all[0], bottom[0]].filter(row => row !== undefined).map(row => row.getAttribute('data-entity-id')!))]
      }, rows)
      expect(ids.length, 'rows to ring').toBeGreaterThan(0)
      const states: [string, () => Promise<void>][] = [
        ['at rest', () => Promise.resolve()],
        ...ids.flatMap((id): [string, () => Promise<void>][] => [
          [`${id} selected`, () => stage.select(id)],
          [
            `${id} hovered`,
            async () => {
              await stage.select(null)
              await stage.hover(id)
            },
          ],
        ]),
      ]
      for (const [state, enter] of states) {
        await enter()
        await stage.measure('settle')
        const report = await cornerReport(page, target, {...options, label: `${selector} ${state}`})
        await attachPictures(report, `${selector} ${state}`)
        expect(report.corners.length, `${state}: corners measured`).toBeGreaterThan(0)
        expect(report.failures).toEqual([])
      }
      await stage.hover(null)
    })
  }
}

test("the report finds a data table's square heading poking past its frame", async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'One engine shows the report reads the pictures.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'code-statistics/gateway-table', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  await stage.frame.locator('head').evaluate(head => {
    const style = document.createElement('style')
    style.textContent =
      '.pk .pk-table > .pk-table-head, .pk .pk-table > .pk-table-head > .pk-table-cell:first-child { border-radius: 0 !important }'
    head.append(style)
  })
  await stage.measure('settle')
  const report = await cornerReport(page, stage.frame.locator('.pk-table-scroll').first(), {frame: 1})
  expect(report.failures.some(failure => failure.startsWith('box top-left corner'))).toBe(true)
  expect(report.failures.some(failure => failure.startsWith('box top-right corner'))).toBe(true)
})

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
  expect(report.failures.filter(failure => /^box top-(?:left|right) corner at 45°: the border is/u.test(failure))).toHaveLength(2)
})
