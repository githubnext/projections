import {expect, test} from '@playwright/test'
import type {FrameLocator} from '@playwright/test'
import {extraction, openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import {after, before, notesAfter, notesBefore, reportAfter, reportBefore} from './fixtures.ts'

const lines = (text: string) => {
  const result = text.split(/\r\n|\n|\r/)
  if (result.at(-1) === '') result.pop()
  return result
}
const texts = {
  before: {report: reportBefore, notes: notesBefore, legacy: 'legacy status: ok\n'},
  after: {report: reportAfter, notes: notesAfter, late: 'PKG-102  Portland\nPKG-104  Denver\nPKG-111  Dallas\n'},
}

/** Each output's lines in reading order, by side: before (removed and unchanged) and after (added and unchanged). */
function sides(frame: FrameLocator) {
  return frame.locator('.text-diff-view').evaluate(root =>
    [...root.querySelectorAll('.text-diff-command')].map(section => {
      const text = (cell: Element) => cell.querySelector('.td-text')!.textContent
      const split = section.querySelector('.td-split')
      if (split) {
        return {
          id: section.getAttribute('data-entity-id')!,
          before: [...split.querySelectorAll('.td-cell.td-side-before:not(.td-filler)')].map(text),
          after: [...split.querySelectorAll('.td-cell.td-side-after:not(.td-filler)')].map(text),
        }
      }
      const rows = [...section.querySelectorAll('.td-lines > .td-row:not(.td-gap):not(.td-empty)')]
      if (!section.querySelector('.td-diff')) {
        return {id: section.getAttribute('data-entity-id')!, before: rows.map(text), after: rows.map(text)}
      }
      return {
        id: section.getAttribute('data-entity-id')!,
        before: rows.filter(row => !row.classList.contains('td-insert')).map(text),
        after: rows.filter(row => !row.classList.contains('td-delete')).map(text),
      }
    }),
  )
}

/** Lines tinted as changed, visible change markers, status cells (and those stating a status), header boxes and sideways overflow of the document. */
function decoration(frame: FrameLocator) {
  return frame.locator('.text-diff-view').evaluate(root => ({
    tinted: [...root.querySelectorAll('.td-delete, .td-insert')].filter(
      line => !/^(transparent|rgba\(0, 0, 0, 0\)|color\(srgb [\d. ]+ \/ 0\))$/.test(getComputedStyle(line).backgroundColor),
    ).length,
    markers: [...root.querySelectorAll('.td-mark')].filter(mark => mark.getBoundingClientRect().width > 0.5 && mark.textContent).length,
    cells: root.querySelectorAll('header .pk-group-status').length,
    status: [...root.querySelectorAll<HTMLElement>('header .pk-group-status')].filter(cell =>
      /^(Added|Removed|Modified|Renamed)/.test(cell.innerText.replace(/\s/g, '')),
    ).length,
    boxes: [...root.querySelectorAll<HTMLElement>('[data-entity-id], header > *')].map(item => {
      const box = item.getBoundingClientRect()
      return [box.x, box.y, box.width, box.height].join()
    }),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
}

const expected = (id: string) => ({
  id,
  before: lines(texts.before[id as keyof typeof texts.before] ?? ''),
  after: lines(texts.after[id as keyof typeof texts.after] ?? ''),
})

test('the renderer declares only the diff comparison mode', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'text-diff', before, after, comparisonMode: 'diff'})
  expect((await renderer.state()).capabilities?.comparisonModes).toEqual(['diff'])
  expect((await renderer.state()).steps).toEqual([])
})

for (const layout of ['split', 'unified'] as const) {
  test(`the ${layout} diff shows every line of both revisions, marked, unclipped`, async ({page}, info) => {
    const renderer = await openRenderer(page, {
      renderer: 'text-diff',
      before,
      after,
      comparisonMode: 'diff',
      options: {textDiffLayout: layout},
      width: 1100,
    })
    // A phone frame is narrower than two columns need, so the diff reads as one column there.
    const shown = info.project.name.includes('mobile') ? 'unified' : layout
    await expect(renderer.frame.locator('[data-entity-id="report"] .td-body').first()).toHaveAttribute('data-layout', shown)
    expect(await sides(renderer.frame)).toEqual(['report', 'notes', 'legacy', 'late'].map(expected))
    const decorated = await decoration(renderer.frame)
    expect(decorated.overflow).toBeLessThanOrEqual(0)
    expect(decorated.markers).toBeGreaterThan(0)
    expect(decorated.tinted).toBe(decorated.markers)
    // Changed, added and removed outputs state their status in a cell every output reserves; nothing is cut off.
    expect(decorated.status).toBe(4)
    expect(decorated.cells).toBe(4)
    expect(await renderer.measure<string[]>('clipping')).toEqual([])
    await expect(renderer.frame.locator('[data-entity-id="report"] .sr-only', {hasText: 'Removed:'}).first()).toBeAttached()
    await expect(renderer.frame.locator('[data-entity-id="report"] .td-delete .td-word', {hasText: 'transit'}).first()).toBeVisible()
  })
}

test('the summary counts the outputs, then their lines as the diff marks them, and the view draws none', async ({page}) => {
  const renderer = await openRenderer(page, {
    renderer: 'text-diff',
    before,
    after,
    comparisonMode: 'diff',
    options: {textDiffLayout: 'unified'},
    width: 1100,
  })
  await expect(renderer.frame.locator('[data-entity-id="report"] .td-body').first()).toHaveAttribute('data-layout', 'unified')
  // Only unchanged lines fold, so every inserted and deleted line is a row of the unified diff.
  const marked = await renderer.frame.locator('.text-diff-view').evaluate(root => ({
    added: root.querySelectorAll('.td-row.td-insert').length,
    removed: root.querySelectorAll('.td-row.td-delete').length,
  }))
  const count = Object.values(texts.after).reduce((sum, text) => sum + lines(text).length, 0)
  await expect
    .poll(async () => (await renderer.state()).summary?.find(item => item.type === 'fact' && item.id === 'lines'))
    .toEqual({type: 'fact', id: 'lines', count, noun: {singular: 'line', plural: 'lines'}, ...marked})
  expect((await renderer.state()).summary?.[0]).toMatchObject({kind: 'output', count: 3, added: 1, removed: 1, modified: 2})
  await expect(renderer.frame.locator('.pk-diff-summary')).toHaveCount(0)
})

test('with highlighting off the diff keeps every line, marker and box but loses its tint and status words', async ({page}) => {
  const renderer = await openRenderer(page, {
    renderer: 'text-diff',
    before,
    after,
    comparisonMode: 'diff',
    highlighting: 'off',
    width: 1100,
  })
  const off = await decoration(renderer.frame)
  expect(off.tinted).toBe(0)
  expect(off.markers).toBeGreaterThan(0)
  expect(off.status).toBe(0)
  const lines = await sides(renderer.frame)
  await renderer.seek(1, {highlighting: 1})
  const on = await decoration(renderer.frame)
  expect(on.tinted).toBe(off.markers)
  expect(on.status).toBe(4)
  expect(on.boxes, 'status words appear without moving anything').toEqual(off.boxes)
  expect(await sides(renderer.frame)).toEqual(lines)
})

test('two columns keep unchanged lines aligned, and a narrow frame reads as one column', async ({page}, info) => {
  test.skip(info.project.name.includes('mobile'), 'A phone frame is always narrow: the 390px half of this test covers it.')
  const renderer = await openRenderer(page, {renderer: 'text-diff', before, after, comparisonMode: 'diff', width: 1100})
  // The layout is a host-drawn control, declared once there is a comparison to lay out.
  await expect.poll(async () => (await renderer.state()).controls.map(control => control.id)).toEqual(['textDiffLayout'])
  await expect(renderer.frame.getByText('Two columns')).toHaveCount(0)
  const split = renderer.frame.locator('[data-entity-id="report"] .td-split')
  const rows = await split.evaluate(grid =>
    [...grid.querySelectorAll('.td-pair')].map(pair => {
      const [left, right] = [...pair.children].map(cell => cell.getBoundingClientRect())
      return {top: [left!.top, right!.top], height: [left!.height, right!.height], left: [left!.left, right!.left]}
    }),
  )
  expect(rows.length).toBeGreaterThan(5)
  for (const row of rows) {
    expect(Math.abs(row.top[0]! - row.top[1]!)).toBeLessThan(0.5)
    expect(Math.abs(row.height[0]! - row.height[1]!)).toBeLessThan(0.5)
    expect(row.left[1]!).toBeGreaterThan(row.left[0]! + 200)
  }
  const prose = renderer.frame.locator('[data-entity-id="notes"] .td-text').first()
  expect(await prose.evaluate(element => getComputedStyle(element).whiteSpace)).toBe('pre-wrap')

  await renderer.setOptions({textDiffLayout: 'unified'})
  await expect(renderer.frame.locator('[data-entity-id="report"] .td-body').first()).toHaveAttribute('data-layout', 'unified')
  await renderer.setOptions({textDiffLayout: 'split'})
  await renderer.setWidth(390)
  await expect(renderer.frame.locator('[data-entity-id="report"] .td-body').first()).toHaveAttribute('data-layout', 'unified')
  expect((await decoration(renderer.frame)).overflow).toBeLessThanOrEqual(0)
  expect(await renderer.measure<string[]>('clipping')).toEqual([])
})

test('long unchanged runs fold into a gap that opens in place and folds again', async ({page}) => {
  const long = Array.from({length: 30}, (_, index) => `line ${index + 1}`)
  const changed = [...long]
  changed[15] = 'line sixteen'
  const output = (text: string[]) =>
    extraction('graph/v0', [{id: 'log', kind: 'output', label: 'tool --log', data: {text: `${text.join('\n')}\n`}}])
  const renderer = await openRenderer(page, {
    renderer: 'text-diff',
    before: output(long),
    after: output(changed),
    comparisonMode: 'diff',
    options: {textDiffLayout: 'unified'},
  })
  const gaps = renderer.frame.getByRole('button', {name: /unchanged lines/})
  await expect(gaps).toHaveCount(2)
  await expect(gaps.first()).toHaveText(/12 unchanged lines/)
  await gaps.first().click()
  await expect(renderer.frame.locator('.td-text', {hasText: /^line 1$/})).toBeVisible()
  // The opened gap stays above its lines, as the way to fold them again, from the keyboard too.
  const hide = renderer.frame.getByRole('button', {name: /^Hide 12 unchanged lines$/})
  await expect(hide).toHaveAttribute('aria-expanded', 'true')
  await hide.press('Enter')
  await expect(renderer.frame.locator('.td-text', {hasText: /^line 1$/})).toHaveCount(0)
  await expect(gaps.first()).toHaveAttribute('aria-expanded', 'false')
})

test('output headers select their output and reflect the host selection', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'text-diff', before, after, comparisonMode: 'diff'})
  const header = renderer.frame.getByRole('button', {name: 'parcel report shipments.json'})
  await header.click()
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe('report')
  await expect(header).toHaveAttribute('aria-pressed', 'true')
  await renderer.select('late')
  await expect(renderer.frame.getByRole('button', {name: 'parcel report --late-only'})).toHaveAttribute('aria-pressed', 'true')
  await expect(header).toHaveAttribute('aria-pressed', 'false')
})

test('an extraction lists its outputs as plain numbered text', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'text-diff', extraction: before})
  expect(await sides(renderer.frame)).toEqual(
    Object.entries(texts.before).map(([id, text]) => ({id, before: lines(text), after: lines(text)})),
  )
  await expect(renderer.frame.getByRole('group', {name: 'Text diff layout'})).toHaveCount(0)
  expect(await decoration(renderer.frame)).toMatchObject({tinted: 0, markers: 0, cells: 0, status: 0})
})

test('invalid output data is reported as an error', async ({page}) => {
  const invalid = extraction('graph/v0', [{id: 'o', kind: 'output', label: 'o', data: {text: 42}}])
  const renderer = await openRenderer(page, {renderer: 'text-diff', extraction: invalid})
  await expect(renderer.frame.getByRole('alert')).toContainText('must contain string data.text')
  await expect.poll(async () => (await renderer.state()).errors.join('\n')).toContain('must contain string data.text')
})

test("command labels are drawn in the code font; status stays whole at the end of a long command's header, which ends in an ellipsis", async ({
  page,
}) => {
  const command = 'parcel report shipments.json --late-only --format csv --carrier regional --since 2026-01-01'
  const long = (text: string) =>
    extraction('graph/v0', [
      {id: 'long', kind: 'output', label: command, data: {text}},
      {id: 'notes', kind: 'output', label: 'Release notes', data: {text: `Notes ${text}`, presentation: 'prose'}},
    ])
  const renderer = await openRenderer(page, {
    renderer: 'text-diff',
    before: long('one\n'),
    after: long('two\n'),
    comparisonMode: 'diff',
    width: 390,
  })
  const {count, proportional} = await renderer.measure<{count: number; proportional: string[]}>('identifiers')
  expect(count).toBeGreaterThan(0)
  expect(proportional).toEqual([])
  const headers = await renderer.frame.locator('.text-diff-view').evaluate(root =>
    [...root.querySelectorAll('.text-diff-command')].map(section => {
      const button = section.querySelector<HTMLElement>('header button')!,
        box = button.getBoundingClientRect()
      const middle = (rect: DOMRect) => rect.top + rect.height / 2
      return {
        id: section.getAttribute('data-entity-id'),
        identifier: button.hasAttribute('data-projections-identifier'),
        title: button.title,
        ellipsis: button.scrollWidth > button.clientWidth + 0.5,
        status: [...section.querySelectorAll<HTMLElement>('header .pk-group-status')].map(cell => {
          const rect = cell.getBoundingClientRect(),
            text = cell.querySelector<HTMLElement>('.pk-status-text')!
          return (
            Math.abs(middle(rect) - middle(box)) < 4 &&
            rect.left >= box.right - 0.5 &&
            rect.right <= section.getBoundingClientRect().right + 0.5 &&
            text.scrollWidth <= text.clientWidth + 0.5 &&
            cell.innerText.includes('Modified')
          )
        }),
      }
    }),
  )
  expect(headers).toEqual([
    {id: 'long', identifier: true, title: command, ellipsis: true, status: [true]},
    {id: 'notes', identifier: false, title: 'Release notes', ellipsis: false, status: [true]},
  ])
})

test('the line-number gutter runs unbroken from the strip or header to the card bottom', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'text-diff', before, after, progress: 1})
  const gaps = await renderer.frame.locator('.text-diff-view').evaluate(root =>
    [...root.querySelectorAll('.text-diff-command')].flatMap(card => {
      const nums = [...card.querySelectorAll('.td-num')]
      if (!nums.length) return []
      const above = card.querySelector('.td-caption') ?? card.querySelector(':scope > header')!
      // The card's inner bottom edge: the body reaches over the card's border, padded by its width.
      const bottom = card.getBoundingClientRect().bottom - parseFloat(getComputedStyle(card).borderBottomWidth)
      const first = Math.min(...nums.map(num => num.getBoundingClientRect().top))
      const last = Math.max(...nums.map(num => num.getBoundingClientRect().bottom))
      return [{id: card.getAttribute('data-entity-id'), top: first - above.getBoundingClientRect().bottom, bottom: bottom - last}]
    }),
  )
  expect(gaps.length).toBeGreaterThan(0)
  for (const gap of gaps) {
    expect(Math.abs(gap.top), `${gap.id}: gutter starts at the strip`).toBeLessThan(0.5)
    expect(Math.abs(gap.bottom), `${gap.id}: gutter reaches the card bottom`).toBeLessThan(0.5)
  }
})

test('at 1280 px a long line wraps, in one column, in two and in one revision, its line numbers on its first line', async ({page}) => {
  const long = `PKG-111  Dallas      late: ${'address verification needed, the recipient could not be matched to a delivery route; '.repeat(3)}/var/spool/parcel/${'x'.repeat(120)}`
  const output = (text: string) => extraction('graph/v0', [{id: 'log', kind: 'output', label: 'parcel report', data: {text}}])
  const head = 'ID       City        Status\n'
  await page.setViewportSize({width: 1280, height: 900})
  const cases = [
    // A diff, its long line added: line numbers and its marker.
    {
      name: 'one column',
      layout: 'unified',
      marked: true,
      load: {
        before: output(head),
        after: output(`${head}${long}\n`),
        comparisonMode: 'diff' as const,
        options: {textDiffLayout: 'unified'},
      },
    },
    {
      name: 'two columns',
      layout: 'split',
      marked: true,
      load: {before: output(head), after: output(`${head}${long}\n`), comparisonMode: 'diff' as const, options: {textDiffLayout: 'split'}},
    },
    // One revision, and an output that didn't change in a comparison: plain numbered lines.
    {name: 'one revision', layout: 'plain', marked: false, load: {extraction: output(`${head}${long}\n`)}},
    {
      name: 'unchanged',
      layout: 'plain',
      marked: false,
      load: {before: output(`${head}${long}\n`), after: output(`${head}${long}\n`), comparisonMode: 'diff' as const},
    },
  ]
  for (const {name, layout, marked, load} of cases) {
    const renderer = await openRenderer(page, {renderer: 'text-diff', ...load})
    await renderer.setWidth(1280)
    const body = renderer.frame.locator('[data-entity-id="log"] .td-body').first()
    await expect(body).toHaveAttribute('data-layout', layout)
    const read = await body.evaluate(element => {
      const line = [...element.querySelectorAll<HTMLElement>('.td-row, .td-cell')]
        .filter(row => row.textContent.includes('/var/spool'))
        .at(-1)!
      const text = line.querySelector<HTMLElement>('.td-text')!
      const top = (selector: string) => [...line.querySelectorAll<HTMLElement>(selector)].map(item => item.getBoundingClientRect().top)
      const height = parseFloat(getComputedStyle(text).lineHeight)
      return {
        overflow: element.scrollWidth - element.clientWidth,
        lines: Math.round(text.getBoundingClientRect().height / height),
        fits: text.scrollWidth <= text.clientWidth + 0.5,
        numbers: top('.td-num').map(value => value - text.getBoundingClientRect().top),
        marks: top('.td-mark').map(value => value - text.getBoundingClientRect().top),
      }
    })
    expect(read.overflow, `${name}: the output doesn't scroll sideways`).toBeLessThanOrEqual(0)
    expect(read.fits, `${name}: the line's text fits its cell`).toBe(true)
    expect(read.lines, `${name}: the long line wraps`).toBeGreaterThan(1)
    expect(read.numbers.length, `${name}: line numbers`).toBeGreaterThan(0)
    expect(read.marks.length > 0, `${name}: a change marker`).toBe(marked)
    for (const top of [...read.numbers, ...read.marks]) expect(Math.abs(top), `${name}: on the line's first line`).toBeLessThan(1)
    expect((await decoration(renderer.frame)).overflow).toBeLessThanOrEqual(0)
  }
})
