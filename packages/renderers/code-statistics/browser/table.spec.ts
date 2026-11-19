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

/** A pixel to read and the color it must be: a line or edge beside a row whose lines carry its hue. */
interface LineProbe {
  what: string
  x: number
  y: number
  rgb: number[]
}

/**
 * Every line and frame edge beside a row whose lines carry its change's hue (added, removed, renamed), with the color
 * it must paint: the hue, faded by the row's presence over what lies under it. Runs in the renderer document.
 */
function tableLineProbes(): LineProbe[] {
  const context = document.createElement('canvas').getContext('2d')!
  const rgb = (color: string) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
  }
  const scroll = document.querySelector('.pk-table-scroll')!.getBoundingClientRect()
  const rows = [...document.querySelectorAll('.pk-table > .pk-table-row')]
  const hued = (row: Element) => row.matches('.pk-region[data-change]') && !row.querySelector('[data-change]')
  const surface = rgb(getComputedStyle(document.querySelector('.pk-table-scroll')!).backgroundColor)
  const divider = rgb(getComputedStyle(document.querySelector('.pk-table-head')!).borderBottomColor)
  const over = (hue: number[], under: number[], opacity: number) => hue.map((c, k) => Math.round(c * opacity + under[k]! * (1 - opacity)))
  const probes: LineProbe[] = []
  rows.forEach((row, index) => {
    if (!hued(row)) return
    const box = row.getBoundingClientRect()
    const style = getComputedStyle(row)
    const opacity = Number(style.opacity)
    if (opacity < 0.05) return
    const name = row.getAttribute('data-entity-id')
    const [above, below] = [rows[index - 1], rows[index + 1]]
    const line = (other: Element | undefined, side: 'borderTopColor' | 'borderBottomColor') =>
      other ? rgb(getComputedStyle(other)[side]) : divider
    // Two fading hued rows composite over each other: the line between them isn't one hue over gray.
    const fading = (other: Element | undefined) => other && hued(other) && Number(getComputedStyle(other).opacity) < 1 && opacity < 1
    const x = Math.min(box.right, scroll.right) - 40
    const y = box.top + box.height / 2
    const edge = over(rgb(style.borderRightColor), surface, opacity)
    if (!fading(above))
      probes.push({
        what: `the line above ${name}`,
        x,
        y: box.top + 0.5,
        rgb: over(rgb(style.borderTopColor), line(above, 'borderBottomColor'), opacity),
      })
    if (!fading(below))
      probes.push({
        what: `the line below ${name}`,
        x,
        y: box.bottom - 0.5,
        rgb: over(rgb(style.borderBottomColor), line(below, 'borderTopColor'), opacity),
      })
    probes.push({what: `the left edge beside ${name}`, x: scroll.left + 0.5, y, rgb: edge})
    if (box.right <= scroll.right + 0.5) probes.push({what: `the right edge beside ${name}`, x: box.right - 0.5, y, rgb: edge})
  })
  return probes
}

/** The screenshot's colors at `points` (CSS px of a `width`-wide frame), decoded in the page: no image library. */
async function pixelsAt({png, width, points}: {png: string; width: number; points: {x: number; y: number}[]}) {
  // Decoded from the bytes themselves: the stage page's content security policy refuses to fetch a data: URL.
  const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], {type: 'image/png'}))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')!
  context.drawImage(bitmap, 0, 0)
  const scale = bitmap.width / width
  return points.map(({x, y}) => [...context.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data.slice(0, 3)])
}

// A gray line and a change-colored one never compete: wherever a row whose lines carry its hue meets another line, a
// row neutral because it holds changed cells, an unchanged row, the heading, the foot or the frame's sides, the hue is
// what paints. Sorting changes which rows are neighbours, so every sort is checked both ways.
for (const comparisonMode of ['diff', 'animated'] as const)
  for (const colorMode of ['light', 'dark'] as const)
    test(`${comparisonMode}, ${colorMode}: a change's hue wins every line it shares`, async ({page}) => {
      test.setTimeout(120_000)
      const inspector = harnessInspector()
      const failures: string[] = []
      for (const sort of ['code:descending', 'name:ascending', 'files:ascending', 'lines:descending'])
        for (const sortChangesFirst of [false, true]) {
          const stage = await openStage(page, inspector, {
            scenario: 'code-statistics/gateway',
            comparisonMode,
            colorMode,
            options: {chart: 'table', sort, sortChangesFirst},
          })
          if (comparisonMode === 'animated') await stage.seek(0.5)
          await stage.measure('settle')
          await page.mouse.move(0, 0)
          const probes: LineProbe[] = await stage.frame.locator('body').evaluate(tableLineProbes)
          const width = (await stage.iframe.boundingBox())!.width
          const png = (await stage.iframe.screenshot()).toString('base64')
          const painted: number[][] = await page.evaluate(pixelsAt, {png, width, points: probes})
          probes.forEach((probe, index) => {
            const color = painted[index]!
            if (Math.max(...probe.rgb.map((channel, k) => Math.abs(channel - color[k]!))) > 12)
              failures.push(`${sort}${sortChangesFirst ? ', changes first' : ''}: ${probe.what} is rgb(${color}), not rgb(${probe.rgb})`)
          })
          expect(probes.length, `${sort}: probes`).toBeGreaterThan(0)
        }
      expect(failures).toEqual([])
    })
