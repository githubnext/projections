import {expect, test} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import type {NestedAccent} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * No nested change colors: a changed item that shows changes inside it is drawn neutral, so only the innermost changes
 * carry a hue. The renderer checks hold every scenario to it (`nested-accents`); these cases show the probe finds the
 * nesting it guards against, by painting the container in its change hue again, as before the rule.
 */
const cases = [
  {
    key: 'graph/npm-react-update',
    what: 'a modified card around its old and new values',
    restore: '.pk .graph-node .node-emphasis.modified { fill: var(--amber-soft) !important }',
  },
  {
    key: 'agentic-workflows/docs-bot',
    what: 'a modified card around its added and removed pills',
    restore: '.pk .pk-region[data-change="modified"] { background-color: var(--amber-soft) !important }',
  },
  {
    key: 'file-packing/sample-app',
    what: 'a changed folder around changed files',
    restore:
      '.pk .fp-emphasis.added { stroke: var(--green-border) !important } .pk .fp-emphasis.removed { stroke: var(--red-border) !important }',
  },
]

const crossing = (nestings: NestedAccent[]) =>
  nestings.filter(
    ({outer, inner}) =>
      inner.family !== outer.family || (inner.property !== 'color' && inner.entity !== undefined && inner.entity !== outer.entity),
  )

for (const {key, what, restore} of cases) {
  test(`${key}: the diff draws ${what} neutral, and the probe finds the nesting when it isn't`, async ({page}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'The probe reads computed styles, the same in every engine.')
    const stage = await openStage(page, harnessInspector(), {scenario: key, progress: 1, comparisonMode: 'diff'})
    await stage.measure('settle')
    expect(crossing(await stage.measure<NestedAccent[]>('accents'))).toEqual([])
    await stage.frame.locator('head').evaluate((head, css) => {
      const style = document.createElement('style')
      style.textContent = css
      head.append(style)
    }, restore)
    await stage.measure('settle')
    expect(crossing(await stage.measure<NestedAccent[]>('accents')).length).toBeGreaterThan(0)
  })
}
