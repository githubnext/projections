import {expect, test} from '@playwright/test'
import {openStage, type NestedAccent} from '@githubnext/projections-renderer-testing/playwright'
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
  nestings.filter(({outer, inner}) => inner.family !== outer.family || (inner.entity !== undefined && inner.entity !== outer.entity))

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

test('the probe measures a closed outline, a straight line in it and what a categorical part holds', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'The probe reads computed styles, the same in every engine.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'graph/npm-react-update', progress: 1, comparisonMode: 'diff'})
  await stage.frame.locator('.pk').evaluate(root => {
    const probe = document.createElement('div')
    probe.innerHTML = `
      <svg width="300" height="120" class="nesting-probe">
        <path d="M 10 10 H 290 V 110 H 10 Z" style="fill: none; stroke: var(--projections-color-modified); stroke-width: 2px" />
        <line x1="40" y1="60" x2="200" y2="60" style="stroke: var(--projections-color-removed); stroke-width: 2px" />
      </svg>
      <div class="nesting-probe-card" style="background: var(--projections-color-modified-muted)">
        <span data-projections-category="probe" style="background: var(--projections-chart-1)">
          <span class="nesting-probe-gain" style="background: var(--projections-color-added-muted)">+</span>
        </span>
      </div>`
    root.prepend(probe)
  })
  const found = crossing(await stage.measure<NestedAccent[]>('accents')).map(({outer, inner}) => `${inner.element} in ${outer.element}`)
  expect(found).toEqual(expect.arrayContaining(['line in path', 'span.nesting-probe-gain in div.nesting-probe-card']))
})
