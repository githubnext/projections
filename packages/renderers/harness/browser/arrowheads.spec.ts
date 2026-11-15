import {expect, test} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'
import {arrowContacts, contactIssues} from '../../kit/browser/invariants/contacts.js'
import {scenarios} from './scenarios.js'

/**
 * Every relationship's arrowhead touches its target card: its painted tip
 * (stroke and round joins included) meets the outer edge of the card's
 * painted border within half a CSS pixel, covering none of it and leaving no
 * gap. Measured from painted geometry in every renderer that draws heads
 * (the graph family, dependency injection and database), at Before, mid-way
 * and After of the progress modes and in diff mode's union (whose changed
 * cards draw a strong change edge), at device pixel ratios 1 and 2.
 */
const drawing = ['graph', 'dependency-injection', 'database']

for (const scale of [1, 2])
  test.describe(`at a device pixel ratio of ${scale}`, () => {
    test.use({deviceScaleFactor: scale})
    for (const directory of drawing)
      test(`${directory}: arrowheads touch their card's border without covering it, animated and in diff mode`, async ({page}) => {
        test.slow()
        const inspector = harnessInspector()
        let measured = 0
        for (const {key} of scenarios.filter(item => item.directory === directory && !item.customComparator)) {
          const stage = await openStage(page, inspector, {scenario: key, progress: 0, comparisonMode: 'animated'})
          for (const progress of [0, 0.5, 1]) {
            await stage.seek(progress)
            const contacts = await stage.frame.locator('.pk').evaluate(arrowContacts)
            measured += contacts.length
            expect(contactIssues(contacts), `${key} at ${progress}`).toEqual([])
          }
          const diff = await openStage(page, inspector, {scenario: key, comparisonMode: 'diff'})
          if ((await diff.state()).comparisonMode !== 'diff') continue
          await diff.measure('settle')
          const contacts = await diff.frame.locator('.pk').evaluate(arrowContacts)
          measured += contacts.length
          expect(contactIssues(contacts), `${key} in diff mode`).toEqual([])
        }
        expect(measured, 'arrowheads measured').toBeGreaterThan(0)
      })
  })
