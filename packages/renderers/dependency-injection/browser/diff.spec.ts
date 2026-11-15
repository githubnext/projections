import {expect, test} from '@playwright/test'
import {checkScenario, openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * Diff mode in the real host frame: the built-in diff checks run (the renderer
 * declares the mode, so none is skipped) and pass for every pair, and the
 * `orders` diff states its changes in words on the cards it changes.
 */
const pairs = ['orders', 'scoring', 'nestjs-orders', 'spring-orders']

for (const pair of pairs) {
  test(`dependency-injection/${pair}: diff checks pass`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium-desktop', 'The checks size their own frames; one project runs them.')
    test.slow()
    const results = await checkScenario(page, harnessInspector(), `dependency-injection/${pair}`, {
      checks: ['diff-changes', 'diff-neutral', 'diff-clipping'],
    })
    expect(results.map(result => [result.id, result.status])).toEqual([
      ['diff-changes', 'pass'],
      ['diff-neutral', 'pass'],
      ['diff-clipping', 'pass'],
    ])
  })
}

test('dependency-injection: a diff card says what changed', async ({page}) => {
  const stage = await openStage(page, harnessInspector(), {scenario: 'dependency-injection/orders', comparisonMode: 'diff'})
  await stage.measure('settle')
  const frame = stage.frame
  // What changed is counted in the host's summary bar: kinds with their changes, then the facets that changed.
  await expect(frame.locator('.pk-diff-summary, .di-summary')).toHaveCount(0)
  await expect
    .poll(async () =>
      ((await stage.state()).summary ?? []).map(item =>
        item.type === 'fact'
          ? `${item.count} ${item.count === 1 ? item.noun.singular : item.noun.plural}`
          : `${item.noun.plural} +${item.added ?? 0} −${item.removed ?? 0}`,
      ),
    )
    .toEqual([
      'services +2 −1',
      'registrations +2 −1',
      'implementations +2 −1',
      'dependencies +3 −2',
      'runtime resolutions +1 −0',
      '1 lifetime changed',
    ])
  const repository = frame.locator('.di-card[data-unit-id="service:Orders:IOrderRepository:unkeyed"]')
  await expect(repository).toHaveAttribute('data-change', 'modified')
  await expect(repository.locator('.di-lifetime-label')).toHaveText('Scoped → Singleton')
  await expect(repository.locator('.pk-svg-status')).toContainText('Lifetime changed')
  await expect(repository.locator('[data-entity-id="service:Orders:IOrderRepository:unkeyed:registration:0"]')).toHaveAttribute(
    'aria-label',
    /lifetime changed, was Scoped, now Singleton/,
  )
  await expect(frame.locator('.di-card[data-unit-id="service:Orders:IPricing:unkeyed"]')).toHaveAttribute('data-change', 'removed')
  await expect(frame.locator('.di-card[data-unit-id="service:Orders:IPriceCalculator:unkeyed"]')).toHaveAttribute('data-change', 'added')
  // The injecting card lists the dependency it lost and the one it gained, and says so in its band; both links are drawn.
  const service = frame.locator('.di-card[data-unit-id="service:Orders:IOrderService:unkeyed"]')
  await expect(service).not.toHaveAttribute('data-change', /./)
  await expect(service.locator('.pk-svg-status')).toContainText('Dependencies changed')
  await expect(service.locator('.di-dependency[data-change="removed"]')).toHaveText('− IPricing')
  await expect(service.locator('.di-dependency[data-change="added"]')).toHaveText('+ IPriceCalculator')
  await expect(frame.locator('[data-edge-key="dependsOn:OrderService:pricing"]')).toHaveAttribute('data-change', 'removed')
  await expect(frame.locator('[data-edge-key="dependsOn:OrderService:prices"]')).toHaveAttribute('data-change', 'added')
  // A changed card's status is centred on it in its band, inside it, as the kit's graph cards draw it.
  for (const card of [repository, service]) {
    await expect(card.locator('.node-footer-band')).toHaveCount(1)
    const rows = await card.evaluate(element => {
      const surface = element.querySelector('.di-card-surface')!.getBoundingClientRect()
      return [...element.querySelectorAll('.pk-svg-status')].map(row => {
        const box = row.getBoundingClientRect()
        return {
          offset: (box.left + box.right) / 2 - (surface.left + surface.right) / 2,
          inside: box.left >= surface.left && box.right <= surface.right,
        }
      })
    })
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(Math.abs(row.offset), 'centred on the card').toBeLessThan(1.5)
      expect(row.inside, 'inside the card').toBe(true)
    }
  }
})
