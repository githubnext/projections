import {expect, test} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * The matrix's capability headings slant (the kit's `SlantedHeading`): each starts over its own column's centre, just
 * above it, and rises up and to the right at 45°; neighbouring headings, parallel and a column apart, don't overlap; the
 * heading row is tall enough that none is clipped at its top; and on a desktop the matrix doesn't scroll sideways.
 */
for (const colorMode of ['light', 'dark'] as const) {
  test(`${colorMode}: the matrix's slanted capability headings start over their columns, apart and unclipped`, async ({page}, info) => {
    const mobile = info.project.name.endsWith('mobile')
    const stage = await openStage(page, harnessInspector(), {
      scenario: 'agentic-workflows/docs-bot-matrix',
      comparisonMode: 'diff',
      colorMode,
    })
    await stage.measure('settle')
    const result = await stage.frame.locator('.aw-matrix').evaluate((table: HTMLTableElement) => {
      const columns = [...table.querySelectorAll<HTMLElement>('th.pk-slanted-column')].flatMap(column => {
        const label = column.querySelector<HTMLElement>('.pk-slanted-heading-label')
        if (!label) return []
        const box = column.getBoundingClientRect()
        const drawn = label.getBoundingClientRect()
        const angle = new DOMMatrix(getComputedStyle(label).transform)
        // The label's middle line starts half its height in from its turned bottom-left corner, the drawn box's
        // bottom-most point; at 45° that's half its height times sin 45° to the left of and above that corner.
        const corner = {x: drawn.left + label.offsetHeight * Math.SQRT1_2, y: drawn.bottom}
        const start = {x: corner.x - (label.offsetHeight / 2) * Math.SQRT1_2, y: corner.y - (label.offsetHeight / 2) * Math.SQRT1_2}
        return [
          {
            text: label.textContent,
            degrees: Math.round((Math.atan2(angle.b, angle.a) * 180) / Math.PI),
            centre: box.left + box.width / 2,
            bottom: box.bottom,
            start,
            corner,
            top: drawn.top,
            height: label.offsetHeight,
          },
        ]
      })
      const scroll = table.parentElement
      return {
        columns,
        headTop: table.tHead?.getBoundingClientRect().top ?? 0,
        sideways: scroll ? scroll.scrollWidth - scroll.clientWidth : 0,
      }
    })
    expect(result.columns.length).toBeGreaterThan(10)
    for (const [index, column] of result.columns.entries()) {
      expect(column.degrees, column.text).toBe(-45)
      // Its middle line starts over its column's centre, and its lowest point just above the column.
      expect(Math.abs(column.start.x - column.centre), column.text).toBeLessThanOrEqual(1.5)
      expect(column.corner.y, column.text).toBeLessThanOrEqual(column.bottom)
      expect(column.bottom - column.corner.y, column.text).toBeLessThanOrEqual(8)
      // Nothing above the heading row: the row is as tall as the longest heading rises.
      expect(column.top, column.text).toBeGreaterThanOrEqual(result.headTop - 0.5)
      // Parallel headings a column apart: their lines are the column's width times sin 45° apart, at least a line.
      const next = result.columns.at(index + 1)
      if (next) {
        expect((next.centre - column.centre) * Math.SQRT1_2, `${column.text} and ${next.text}`).toBeGreaterThanOrEqual(column.height)
      }
    }
    if (!mobile) expect(result.sideways, 'the matrix scrolls sideways').toBeLessThanOrEqual(1)
  })
}
