import {readFileSync} from 'node:fs'

/**
 * Plain protocol-v0 extraction pairs, for unit tests, the shared browser test
 * bed and host demos. `languages` is a small pair covering arrival, departure, growth and
 * shrinkage; `gateway` is a JavaScript-to-TypeScript migration across a dozen
 * languages, with CoffeeScript retired and Rust and Protobuf arriving. `scopes` is generic measurements (no line
 * counts): methods per access scope, each entity's `data.value` in `data.unit`.
 */
export const scenarios = ['languages', 'gateway']
export const fixtureUrl = (scenario, side) => new URL(`./fixtures/${scenario}-${side}.json`, import.meta.url)
export const loadPair = scenario => ({
  before: JSON.parse(readFileSync(fixtureUrl(scenario, 'before'), 'utf8')),
  after: JSON.parse(readFileSync(fixtureUrl(scenario, 'after'), 'utf8')),
})
/** The `languages` pair, one side at a time. */
export const loadFixture = side => loadPair('languages')[side]
