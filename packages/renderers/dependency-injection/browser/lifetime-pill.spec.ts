import {expect, test} from '@playwright/test'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import {opticalInsets} from '@githubnext/projections-renderer-testing/playwright'
import type {Extraction} from '@githubnext/projections-schemas'
import {loadFixture} from '../test/fixtures.mjs'

const before = loadFixture('before') as Extraction
const after = loadFixture('after') as Extraction

// Room to draw the composition unscaled, at a device scale that measures half pixels.
test.use({viewport: {width: 2400, height: 1600}, deviceScaleFactor: 2})

test('the lifetime is a pill, aligned optically, and its hover stays in its shape', async ({page}, info) => {
  test.skip(info.project.name.includes('mobile'), 'Measured on a wide desktop viewport.')
  const renderer = await openRenderer(page, {renderer: 'dependency-injection', before, after, progress: 1})
  const frame = renderer.frame
  const card = frame
    .locator('.di-card')
    .filter({has: frame.locator('.di-zone-registration')})
    .first()
  const label = card.locator('.di-lifetime-label')
  const pill = card.locator('.di-lifetime-pill-surface')
  const scale = Number(await frame.locator('svg.di-canvas').getAttribute('data-scale'))

  // The pill's edges are on whole card units.
  for (const attribute of ['x', 'y', 'width', 'height']) {
    expect(Number.isInteger(Number(await pill.getAttribute(attribute))), attribute).toBe(true)
  }

  // A capital E first and a capital H last: as much space above the E, below it, left of its stem and right of the H's.
  await label.evaluate(text => (text.textContent = 'EH'))
  await expect.poll(async () => Number(await pill.getAttribute('width'))).toBeLessThan(40)
  const rest = await opticalInsets(page, {surface: pill, ink: label})
  const gaps = [rest.top, rest.bottom, rest.left, rest.right].map(gap => gap / scale)
  expect(Math.max(...gaps) - Math.min(...gaps), `gaps ${gaps.map(gap => gap.toFixed(2)).join(', ')}`).toBeLessThanOrEqual(1.25)
  for (const gap of gaps) expect(gap).toBeGreaterThan(2.5)

  // Hovered, the tint is the pill's own shape: the painted pill neither grows nor moves.
  await card.locator('.di-zone-registration').hover()
  const hovered = await opticalInsets(page, {surface: card.locator('.di-lifetime-pill'), ink: label})
  for (const side of ['top', 'bottom', 'left', 'right'] as const) expect(hovered[side], side).toBeCloseTo(rest[side], 0)
})
