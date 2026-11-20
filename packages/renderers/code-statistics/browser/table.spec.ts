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

/**
 * A pixel to read on a line or edge beside a row whose lines carry its hue: the color it paints when the hue wins
 * (`rgb`), and when the gray line beside it would (`gray`).
 */
interface LineProbe {
  what: string
  x: number
  y: number
  /** The line's direction across which it is sampled: `y` for a horizontal line, `x` for an edge. */
  across: 'x' | 'y'
  rgb: number[]
  gray: number[]
}

/**
 * Every line and frame edge beside a row whose lines carry its change's hue (added, removed, renamed), with the color
 * it paints when the hue wins (faded by the row's presence over what lies under it) and when the gray line would.
 * Runs in the renderer document.
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
    const gray = {above: line(above, 'borderBottomColor'), below: line(below, 'borderTopColor')}
    // The rule under the heading is the heading's, the frame's color (checked on its own below).
    if (!fading(above) && !above?.matches('.pk-table-head'))
      probes.push({
        gray: gray.above,
        what: `the line above ${name}`,
        x,
        y: box.top + 0.5,
        across: 'y',
        rgb: over(rgb(style.borderTopColor), line(above, 'borderBottomColor'), opacity),
      })
    if (!fading(below))
      probes.push({
        gray: gray.below,
        what: `the line below ${name}`,
        x,
        y: box.bottom - 0.5,
        across: 'y',
        rgb: over(rgb(style.borderBottomColor), line(below, 'borderTopColor'), opacity),
      })
    probes.push({what: `the left edge beside ${name}`, x: scroll.left + 0.5, y, across: 'x', rgb: edge, gray: divider})
    if (box.right <= scroll.right + 0.5)
      probes.push({what: `the right edge beside ${name}`, x: box.right - 0.5, y, across: 'x', rgb: edge, gray: divider})
  })
  return probes
}

/**
 * The screenshot's colors across each line (CSS px of a `width`-wide frame), one per device pixel within a CSS pixel
 * either side, decoded in the page: no image library. At a fractional pixel ratio a line snaps to device pixels, so
 * it is found among them rather than at one point.
 */
async function pixelsAt({png, width, points}: {png: string; width: number; points: {x: number; y: number; across: 'x' | 'y'}[]}) {
  // Decoded from the bytes themselves: the stage page's content security policy refuses to fetch a data: URL.
  const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], {type: 'image/png'}))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')!
  context.drawImage(bitmap, 0, 0)
  const scale = bitmap.width / width
  return points.map(({x, y, across}) => {
    const at = across === 'y' ? y : x
    const pixels: number[][] = []
    for (let device = Math.floor((at - 1) * scale); device <= Math.ceil((at + 1) * scale); device++) {
      const [px, py] = across === 'y' ? [Math.floor(x * scale), device] : [device, Math.floor(y * scale)]
      if (px >= 0 && py >= 0 && px < bitmap.width && py < bitmap.height)
        pixels.push([...context.getImageData(px, py, 1, 1).data.slice(0, 3)])
    }
    return pixels
  })
}

// A gray line and a change-colored one never compete: wherever a row whose lines carry its hue meets another line, a
// row neutral because it holds changed cells, an unchanged row, the heading, the foot or the frame's sides, the hue is
// what paints. Sorting changes which rows are neighbours, so every sort is checked both ways.
for (const comparisonMode of ['diff', 'animated'] as const)
  for (const colorMode of ['light', 'dark'] as const)
    test(`${comparisonMode}, ${colorMode}: a change's hue wins every line it shares`, async ({page}) => {
      test.setTimeout(240_000)
      test.skip(
        !Number.isInteger(await page.evaluate(() => devicePixelRatio)),
        'At a fractional pixel ratio a one-pixel line is antialiased into the fills beside it, so its pixels say nothing about which line wins',
      )
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
          // Animated: through the transition, where each language's own step emphasizes it in turn.
          let probed = 0
          for (const progress of comparisonMode === 'animated' ? [0.15, 0.3, 0.45, 0.6, 0.75, 0.9] : [1]) {
            if (comparisonMode === 'animated') await stage.seek(progress)
            await stage.measure('settle')
            await page.mouse.move(0, 0)
            const probes: LineProbe[] = await stage.frame.locator('body').evaluate(tableLineProbes)
            if (!probes.length) continue
            probed += probes.length
            const width = (await stage.iframe.boundingBox())!.width
            const png = (await stage.iframe.screenshot()).toString('base64')
            const painted: number[][][] = await page.evaluate(pixelsAt, {png, width, points: probes})
            // The hue wins when the pixel is nearer it than the gray: compositing and antialiasing at fractional pixel
            // ratios move it a little, never across. Probes whose two colors are too close to tell apart are skipped.
            const distance = (a: number[], b: number[]) => Math.hypot(...a.map((channel, k) => channel - b[k]!))
            probes.forEach((probe, index) => {
              if (distance(probe.rgb, probe.gray) < 24) return
              // The line's own pixel: the one across it most like either color it could paint.
              const near = (pixel: number[]) => Math.min(distance(pixel, probe.rgb), distance(pixel, probe.gray))
              const color = painted[index]!.reduce((best, pixel) => (near(pixel) < near(best) ? pixel : best))
              if (distance(color, probe.rgb) >= distance(color, probe.gray))
                failures.push(
                  `${sort}${sortChangesFirst ? ', changes first' : ''} at ${progress}: ${probe.what} is rgb(${color}), not rgb(${probe.rgb})`,
                )
            })
          }
          expect(probed, `${sort}: probes`).toBeGreaterThan(0)
        }
      expect(failures).toEqual([])
    })

/**
 * The heading's lines, in the renderer document: the rule under it and the frame's top and left edges beside it, each
 * a CSS pixel either side, for `pixelsAt`.
 */
function headingLines() {
  const head = document.querySelector('.pk-table-head')!.getBoundingClientRect()
  const scroll = document.querySelector('.pk-table-scroll')!.getBoundingClientRect()
  const x = head.left + Math.min(300, head.width / 2)
  return {
    first: document.querySelector('.pk-table > [data-entity-id]')?.getAttribute('data-change') ?? 'unchanged',
    points: [
      {x, y: head.bottom - 0.5, across: 'y' as const},
      {x, y: head.top + 0.5, across: 'y' as const},
      {x: scroll.left + 0.5, y: head.top + head.height / 2, across: 'x' as const},
    ],
  }
}

// The heading is the frame's: the rule under it is the frame's color, never a row's, whichever row the sort puts under
// it, changed or not.
for (const colorMode of ['light', 'dark'] as const)
  test(`${colorMode}: the rule under the heading is the frame's color`, async ({page}) => {
    test.setTimeout(120_000)
    test.skip(
      !Number.isInteger(await page.evaluate(() => devicePixelRatio)),
      'At a fractional pixel ratio a one-pixel line is antialiased into the fills beside it',
    )
    const inspector = harnessInspector()
    const firsts = new Set<string>()
    for (const sort of ['none', 'code:descending', 'name:ascending', 'files:ascending'])
      for (const sortChangesFirst of [false, true]) {
        const stage = await openStage(page, inspector, {
          scenario: 'code-statistics/gateway',
          comparisonMode: 'diff',
          colorMode,
          options: {chart: 'table', sort, sortChangesFirst},
        })
        await stage.measure('settle')
        await page.mouse.move(0, 0)
        const {first, points} = await stage.frame.locator('body').evaluate(headingLines)
        firsts.add(first)
        const width = (await stage.iframe.boundingBox())!.width
        const png = (await stage.iframe.screenshot()).toString('base64')
        const [rule, top, side] = (await page.evaluate(pixelsAt, {png, width, points})).map(line => {
          // The line's own pixel: the darkest in light, the lightest in dark, against the band beside it.
          const weight = (pixel: number[]) => pixel.reduce((sum, channel) => sum + channel, 0)
          return line.reduce((best, pixel) =>
            (colorMode === 'light' ? weight(pixel) < weight(best) : weight(pixel) > weight(best)) ? pixel : best,
          )
        })
        const where = `${sort}${sortChangesFirst ? ', changes first' : ''} (${first} row under the heading)`
        expect(rule, `${where}: the rule under the heading against the frame's left edge`).toEqual(side)
        expect(top, `${where}: the frame's top edge against its left edge`).toEqual(side)
      }
    // The sorts put both an unchanged or neutral row and a changed one under the heading.
    expect([...firsts].some(change => change === 'removed' || change === 'added')).toBe(true)

    // A focused heading over a hovered row, unchanged, neutral or changed: the heading still wins. Read the line's
    // exact pixel, as the hovered row's ring is drawn beside it.
    for (const [sort, expected] of [
      ['comment:ascending', 'unchanged'],
      ['code:descending', 'modified'],
      ['name:ascending', 'removed'],
    ] as const) {
      const stage = await openStage(page, inspector, {
        scenario: 'code-statistics/gateway',
        comparisonMode: 'diff',
        colorMode,
        options: {chart: 'table', sort},
      })
      await stage.measure('settle')
      await page.keyboard.press('Shift')
      await stage.frame.getByRole('button', {name: 'Language'}).focus()
      await stage.frame.locator('.pk-table > [data-entity-id]').first().hover()
      await stage.measure('settle')
      const {first, points} = await stage.frame.locator('body').evaluate(headingLines)
      expect(first, sort).toBe(expected)
      const width = (await stage.iframe.boundingBox())!.width
      const png = (await stage.iframe.screenshot()).toString('base64')
      const scale = await page.evaluate(() => devicePixelRatio)
      const exact = (await page.evaluate(pixelsAt, {png, width, points})).map((line, index) => {
        const at = points[index]!.across === 'y' ? points[index]!.y : points[index]!.x
        return line[Math.floor(at * scale) - Math.floor((at - 1) * scale)]
      })
      expect(exact[0], `${sort}: a focused heading's rule over a hovered ${first} row`).toEqual(exact[2])
    }
  })
