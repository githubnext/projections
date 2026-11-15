import {expect, test} from '@playwright/test'
import {extraction, openRenderer, samples} from '@githubnext/projections-renderer-harness/playwright'

const service = (id: string) => ({id, kind: 'service', label: id})
const before = extraction(
  'graph/v0',
  [service('checkout'), service('legacy')],
  [{id: 'calls', kind: 'calls', from: 'checkout', to: 'legacy'}],
)
const after = extraction(
  'graph/v0',
  [service('checkout'), service('payments')],
  [{id: 'pays', kind: 'calls', from: 'checkout', to: 'payments'}],
)

test('the harness runs a bundle in the real host frame and drives it through the protocol', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'graph', before, after, progress: 0})
  await expect(renderer.iframe).toHaveAttribute('sandbox', 'allow-scripts')
  const root = renderer.frame.locator('[data-renderer]').first()
  await expect(root).toHaveAttribute('data-progress', '0')
  let state = await renderer.state()
  expect(state.bundle).toBe('graph')
  expect(state.rendered).toBe(0)
  expect(state.steps.length).toBeGreaterThan(0)

  await renderer.scrub(samples(4, {roundTrip: true}), async progress => {
    await expect(root).toHaveAttribute('data-progress', String(progress))
    expect((await renderer.state()).rendered).toBe(progress)
  })
  state = await renderer.seek(0.5, {highlighting: 'off'})
  expect(state.highlighting).toBe(0)
  await expect(root).toHaveAttribute('data-highlighting', '0')

  await renderer.select('checkout')
  await expect(page.locator('#stage')).toHaveAttribute('data-selection', 'checkout')
  await renderer.seek(1)
  await renderer.frame.locator('[data-entity-id="payments"]').first().click()
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe('payments')
})

test('extractions present at progress 1 with no highlighting', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'graph', extraction: after})
  const state = await renderer.state()
  expect(state).toMatchObject({rendered: 1, highlighting: 0, steps: []})
  await expect(renderer.frame.locator('[data-entity-id="payments"]').first()).toBeVisible()
})
