import {expect, test} from '@playwright/test'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import {before as invoicing} from '../test/fixtures.mjs'

/**
 * A tag's status tab joins it at its left, the tag's bottom-left corner square, and the tag's name is centred. A tag
 * no wider than its tab and a corner radius is as wide as the tab (the tag's slot is the wider of its name and its
 * tab), the tab spans it from border to border, and both its bottom corners are square; a wider tag keeps its
 * bottom-right corner, with the tab clear of it.
 */
// Close-ups for review: STATUS_TAB_SHOTS=<directory> saves each tag, and the row, at four times its size.
const shots = process.env.STATUS_TAB_SHOTS
if (shots) test.use({deviceScaleFactor: 4})

const extension = (name: string) => ({id: `extension:${name}`, kind: 'extension', label: name, data: {version: '1.0'}})
const long = 'a_long_extension_name_for_tags'
// A row of mixed widths, like a list of services: some shorter than their tab, some longer.
const kept = ['vigilance', 'metricsd']
const before = {...invoicing, entities: [...invoicing.entities, ...[...kept, 'gone', long, 'billing_reconciler'].map(extension)]}
const after = {
  ...invoicing,
  entities: [...invoicing.entities, ...[...kept, 'alive', 'usersd', 'authgateway', 'ingest_scheduler', 'rated'].map(extension)],
}

for (const colorMode of ['light', 'dark'] as const) {
  test(`status tabs join their tag at its left, and are flush with a tag no wider than them (${colorMode})`, async ({page}, info) => {
    const renderer = await openRenderer(page, {renderer: 'database', before, after, comparisonMode: 'diff', colorMode} as Parameters<
      typeof openRenderer
    >[1])
    await renderer.measure('settle')
    const tag = (name: string) => renderer.frame.locator(`.database-tags .database-tag[data-entity-id="extension:${name}"]`)
    const geometry = (name: string) =>
      tag(name).evaluate(pill => {
        const box = pill.getBoundingClientRect()
        const tab = pill.querySelector('.pk-status-tab')!.getBoundingClientRect()
        const text = pill.querySelector('.database-tag-name')!
        const range = document.createRange()
        range.selectNodeContents(text)
        const words = range.getBoundingClientRect()
        const style = getComputedStyle(pill)
        return {
          left: box.left,
          right: box.right,
          tabLeft: tab.left,
          tabRight: tab.right,
          textCentre: (words.left + words.right) / 2,
          centre: (box.left + box.right) / 2,
          corners: [style.borderBottomLeftRadius, style.borderBottomRightRadius],
        }
      })
    for (const name of ['alive', 'usersd', 'gone']) {
      const shape = await geometry(name)
      expect(Math.abs(shape.tabLeft - shape.left), `${name}: the tab's left edge is the tag's`).toBeLessThan(0.75)
      expect(Math.abs(shape.tabRight - shape.right), `${name}: the tab's right edge is the tag's`).toBeLessThan(0.75)
      expect(shape.corners, `${name}: square where the tab joins`).toEqual(['0px', '0px'])
      expect(Math.abs(shape.textCentre - shape.centre), `${name}: its name is centred`).toBeLessThan(1)
    }
    for (const name of [long, 'billing_reconciler', 'ingest_scheduler']) {
      const wide = await geometry(name)
      expect(Math.abs(wide.tabLeft - wide.left), `${name}: its tab joins its left edge`).toBeLessThan(0.75)
      expect(wide.right - wide.tabRight, `${name}: its tab clears the right corner`).toBeGreaterThan(4)
      expect(wide.corners[0], `${name}: square where the tab joins`).toBe('0px')
      expect(wide.corners[1], `${name}: keeps its bottom-right corner`).not.toBe('0px')
    }
    if (shots) {
      const file = (name: string) => `${shots}/${name}-${colorMode}-${info.project.name}.png`
      for (const name of ['alive', 'usersd', long]) {
        await tag(name)
          .locator('xpath=..')
          .screenshot({path: file(name === long ? 'long' : name), scale: 'device'})
      }
      const row = (await renderer.frame.locator('.database-tags').boundingBox())!
      const margin = 8
      await page.screenshot({
        path: file('row'),
        scale: 'device',
        clip: {x: row.x - margin, y: row.y - margin, width: row.width + 2 * margin, height: row.height + 2 * margin},
      })
    }
  })
}
