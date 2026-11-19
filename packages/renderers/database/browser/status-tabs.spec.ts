import {expect, test} from '@playwright/test'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import {before as invoicing} from '../test/fixtures.mjs'

/**
 * A tag's status tab is centred under it, and so is the tag's name. A tag no wider than its tab and a corner radius
 * each side is as wide as the tab (the tag's slot is the wider of its name and its tab), the tab spans it from border to
 * border, and the tag's bottom corners are square; a wider tag keeps its corners, with the tab centred clear of them.
 */
// Close-ups for review: STATUS_TAB_SHOTS=<directory> saves each tag at four times its size.
if (process.env.STATUS_TAB_SHOTS) test.use({deviceScaleFactor: 4})

const extension = (name: string) => ({id: `extension:${name}`, kind: 'extension', label: name, data: {version: '1.0'}})
const long = 'a_long_extension_name_for_tags'
const before = {...invoicing, entities: [...invoicing.entities, extension('gone'), extension(long)]}
const after = {...invoicing, entities: [...invoicing.entities, extension('alive')]}

for (const colorMode of ['light', 'dark'] as const)
  test(`status tabs are centred, and flush with a tag no wider than them (${colorMode})`, async ({page}, info) => {
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
          tabCentre: (tab.left + tab.right) / 2,
          textCentre: (words.left + words.right) / 2,
          centre: (box.left + box.right) / 2,
          corners: [style.borderBottomLeftRadius, style.borderBottomRightRadius],
        }
      })
    for (const name of ['alive', 'gone']) {
      const shape = await geometry(name)
      expect(Math.abs(shape.tabLeft - shape.left), `${name}: the tab's left edge is the tag's`).toBeLessThan(0.75)
      expect(Math.abs(shape.tabRight - shape.right), `${name}: the tab's right edge is the tag's`).toBeLessThan(0.75)
      expect(shape.corners, `${name}: square where the tab joins`).toEqual(['0px', '0px'])
      expect(Math.abs(shape.textCentre - shape.centre), `${name}: its name is centred`).toBeLessThan(1)
    }
    const wide = await geometry(long)
    expect(Math.abs(wide.tabCentre - wide.centre), 'a wide tag: its tab is centred').toBeLessThan(1)
    expect(wide.tabLeft - wide.left, 'a wide tag: its tab clears the corner').toBeGreaterThan(4)
    expect(
      wide.corners.every(corner => corner !== '0px'),
      'a wide tag keeps its corners',
    ).toBe(true)
    if (process.env.STATUS_TAB_SHOTS)
      for (const name of ['alive', 'gone', long])
        await tag(name)
          .locator('xpath=..')
          .screenshot({
            path: `${process.env.STATUS_TAB_SHOTS}/${name === long ? 'long' : name}-${colorMode}-${info.project.name}.png`,
            scale: 'device',
          })
  })
