import {expect, test} from '@playwright/test'
import type {FrameLocator} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * The table chart (the kit's `DataTable`): headings sort through the host's controls, the order holds for the whole
 * transition, and the first column stays in view when the table scrolls sideways.
 */
const counts = (frame: FrameLocator, column: number) =>
  frame
    .locator('.pk-table > [role="row"][data-entity-id]')
    .evaluateAll(
      (rows: Element[], index: number) =>
        rows.map(row =>
          Number((row.children[index]?.querySelector('ins, .pk-table-text, .pk-table-value')?.textContent ?? '').replace(/\D/g, '')),
        ),
      column,
    )

test('headings sort the table through the host, both ways', async ({page}) => {
  const stage = await openStage(page, harnessInspector(), {
    scenario: 'code-statistics/gateway',
    comparisonMode: 'diff',
    options: {chart: 'table'},
  })
  await stage.measure('settle')
  const frame = stage.frame
  await expect(frame.getByRole('table', {name: 'Languages'})).toBeVisible()
  await expect(frame.getByRole('columnheader', {name: 'Code'})).toHaveAttribute('aria-sort', 'descending')
  await frame.getByRole('button', {name: 'Files'}).click()
  await expect(frame.getByRole('columnheader', {name: 'Files'})).toHaveAttribute('aria-sort', 'descending')
  await expect(frame.getByRole('columnheader', {name: 'Code'})).not.toHaveAttribute('aria-sort')
  const descending = await counts(frame, 1)
  expect(descending).toEqual([...descending].sort((a, b) => b - a))
  await frame.getByRole('button', {name: 'Files'}).press('Enter')
  await expect(frame.getByRole('columnheader', {name: 'Files'})).toHaveAttribute('aria-sort', 'ascending')
  const ascending = await counts(frame, 1)
  expect(ascending).toEqual([...ascending].sort((a, b) => a - b))
})

test('the rows keep one order for the whole transition', async ({page}) => {
  const stage = await openStage(page, harnessInspector(), {
    scenario: 'code-statistics/gateway',
    comparisonMode: 'animated',
    options: {chart: 'table', sort: 'lines:ascending'},
  })
  const order = () =>
    stage.frame.locator('.pk-table > [role="row"][data-entity-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-entity-id')))
  await stage.seek(0)
  const first = await order()
  for (const progress of [0.2, 0.45, 0.5, 0.75, 1]) {
    await stage.seek(progress)
    expect(await order(), `the order at ${progress}`).toEqual(first)
  }
})

test('the first column stays in view when the table scrolls sideways', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844})
  const stage = await openStage(page, harnessInspector(), {
    scenario: 'code-statistics/gateway',
    comparisonMode: 'diff',
    options: {chart: 'table'},
  })
  await stage.measure('settle')
  const scroll = stage.frame.locator('.pk-table-scroll')
  const scrolled = await scroll.evaluate(element => {
    element.scrollLeft = element.scrollWidth
    return element.scrollLeft
  })
  expect(scrolled).toBeGreaterThan(0)
  const [scroller, heading] = await Promise.all([
    scroll.boundingBox(),
    stage.frame.locator('.pk-table > [role="row"][data-entity-id] > [role="rowheader"]').first().boundingBox(),
  ])
  expect(Math.abs(heading!.x - scroller!.x)).toBeLessThan(0.5)
})
