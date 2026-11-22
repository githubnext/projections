import {expect, test, type Page} from '@playwright/test'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import {before as invoicing} from '../test/fixtures.mjs'

/** A diff in a frame too small to fit it, so it opens at the text floor on its first change. */
async function openDiff(page: Page, before: unknown, after: unknown, reuse = false) {
  await page.setViewportSize({width: 390, height: 320})
  const renderer = await openRenderer(page, {
    renderer: 'database',
    before,
    after,
    comparisonMode: 'diff',
    width: 390,
    height: 320,
    ...(reuse ? {reuse} : {}),
  } as Parameters<typeof openRenderer>[1])
  await renderer.measure('settle')
  expect(Number(await renderer.frame.locator('.database-view').getAttribute('data-zoom')), 'opens zoomed').toBeGreaterThan(1)
  return renderer
}

test('a diff whose only change is a relationship opens on the row the link leaves', async ({page}) => {
  // The last table in the stack gains its foreign key; its column and both tables are unchanged.
  const key = 'relation:FK_InvoiceLines_Invoices_InvoiceId'
  const before = {...invoicing, relationships: invoicing.relationships.filter(row => row.id !== key)}
  const renderer = await openDiff(page, before, invoicing)
  const shown = await renderer.frame.locator('.database-view').evaluate((view, key) => {
    const link = view.querySelector<SVGPathElement>(`[data-entity-id="${CSS.escape(key)}"][data-change] path.database-link`)!
    const start = new DOMPoint(link.getPointAtLength(0).x, link.getPointAtLength(0).y).matrixTransform(link.getScreenCTM()!)
    const area = view.getBoundingClientRect()
    return start.x >= area.left && start.x <= area.right && start.y >= area.top && start.y <= area.bottom
  }, key)
  expect(shown, 'the added link leaves a row in view').toBe(true)
})

// Sixty unchanged extensions, then one more: `first` and `last` upgrade the first or the last of them, whose tags are
// lines apart, and every revision has the same size.
const extension = (name: string, version: string) => ({id: `extension:${name}`, kind: 'extension', label: name, data: {version}})
const names = Array.from({length: 60}, (_, index) => `ext_${String(index).padStart(2, '0')}`)
const revision = (first: string, last: string) => ({
  ...invoicing,
  entities: [...invoicing.entities, ...names.map((name, index) => extension(name, index ? '1.0' : first)), extension('zz_upgraded', last)],
})
const changedTagShown = (renderer: Awaited<ReturnType<typeof openDiff>>) =>
  renderer.frame.locator('.database-view').evaluate(view => {
    const area = view.getBoundingClientRect()
    const tag = view.querySelector('.database-tags > .database-tag-slot .database-tag[data-change]')!.getBoundingClientRect()
    const [x, y] = [tag.left + tag.width / 2, tag.top + tag.height / 2]
    return x >= area.left && x <= area.right && y >= area.top && y <= area.bottom
  })

test('a diff whose only change is a tag lines below the others opens on it, not on the hidden copies tags are measured from', async ({
  page,
}) => {
  const renderer = await openDiff(page, revision('1.0', '1.0'), revision('1.0', '2.0'))
  expect(await changedTagShown(renderer), 'the changed tag is in view').toBe(true)
})

test('another comparison presented in the same frame opens on its own changes', async ({page}) => {
  // The same size and text floor, so nothing but the comparison changes: the view must still move to its change.
  await openDiff(page, revision('1.0', '1.0'), revision('1.0', '2.0'), true)
  const renderer = await openDiff(page, revision('1.0', '1.0'), revision('2.0', '1.0'), true)
  expect(await changedTagShown(renderer), 'the second comparison’s changed tag is in view').toBe(true)
})
