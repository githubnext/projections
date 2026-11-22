import {mkdirSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * Diff mode draws the union of both revisions once: no card overlaps
 * another, every changed row sits inside its card, and highlighting off
 * draws the same boxes. Set `PROJECTIONS_DIFF_SCREENSHOTS` to a directory to
 * save every comparison's diff in light and dark at the project's width.
 */
const comparisons = ['prisma-shop', 'django-library', 'organizations', 'cleanup']
const shots = process.env.PROJECTIONS_DIFF_SCREENSHOTS

for (const name of comparisons) {
  test(`database diff: ${name} lays out both revisions without overlap`, async ({page}, info) => {
    const inspector = harnessInspector()
    for (const colorMode of ['light', 'dark'] as const) {
      const stage = await openStage(page, inspector, {scenario: `database/${name}`, comparisonMode: 'diff', colorMode})
      await stage.measure('settle')
      const drawn = () =>
        stage.frame.locator('.database-view').evaluate(view => {
          const box = (element: Element) => {
            const {x, y, width, height} = element.getBoundingClientRect()
            return {x, y, width, height}
          }
          return {
            cards: [...view.querySelectorAll('.database-table')].map(card => ({
              id: card.getAttribute('data-entity-id')!,
              ...box(card),
              rows: [...card.querySelectorAll('.database-column')].map(box),
            })),
            summary: view.querySelectorAll('.pk-diff-summary').length,
          }
        })
      const shown = await drawn()
      expect(shown.summary, "no summary line: the host's summary bar counts the comparison").toBe(0)
      for (const [index, card] of shown.cards.entries()) {
        for (const other of shown.cards.slice(index + 1)) {
          expect(
            card.x < other.x + other.width - 0.5 &&
              other.x < card.x + card.width - 0.5 &&
              card.y < other.y + other.height - 0.5 &&
              other.y < card.y + card.height - 0.5,
            `${card.id} overlaps ${other.id}`,
          ).toBe(false)
        }
        for (const row of card.rows) {
          expect(row.y + row.height, `a row of ${card.id} ends inside it`).toBeLessThanOrEqual(card.y + card.height + 0.5)
        }
      }
      // Highlighting off paints plainly in the same boxes.
      await stage.seek(1, {highlighting: 'off'})
      await stage.measure('settle')
      expect((await drawn()).cards.map(card => [card.id, card.width, card.height])).toEqual(
        shown.cards.map(card => [card.id, card.width, card.height]),
      )
      if (shots && info.project.name.startsWith('chromium')) {
        mkdirSync(shots, {recursive: true})
        await stage.seek(1, {highlighting: 1})
        await stage.measure('settle')
        const width = info.project.name.endsWith('mobile') ? 390 : 1440
        await stage.frame.locator('body').screenshot({path: `${shots}/database-${name}-${colorMode}-${width}.png`})
      }
    }
  })
}
