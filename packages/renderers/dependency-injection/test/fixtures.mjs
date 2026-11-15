import {readFileSync} from 'node:fs'

/**
 * Plain protocol-v0 extraction pairs, for unit tests, the shared browser test
 * bed and host demos. `orders` exercises every card feature (keyed, stacked,
 * collection, optional and runtime links, add, remove, lifetime change);
 * `scoring` inserts a normalizer into a constructor chain while a cache
 * becomes shared; `nestjs-orders` and `spring-orders` are real `nestjs-di` and
 * `spring-di` output for their sample applications.
 */
export const scenarios = ['orders', 'scoring', 'nestjs-orders', 'spring-orders']
export const fixtureUrl = (scenario, side) => new URL(`./fixtures/${scenario}-${side}.json`, import.meta.url)
export const loadPair = scenario => ({
  before: JSON.parse(readFileSync(fixtureUrl(scenario, 'before'), 'utf8')),
  after: JSON.parse(readFileSync(fixtureUrl(scenario, 'after'), 'utf8')),
})
/** The `orders` pair, one side at a time. */
export const loadFixture = side => loadPair('orders')[side]
