/*
 * The built-in renderer checks: the invariants the Projections renderer
 * harness enforces, run against a live renderer in a real host frame. They
 * drive a stage through `CheckDriver` and measure the renderer document with
 * the check probe. The Inspector's fixtures mode runs them in its checks
 * panel; `checkScenario` from `@githubnext/projections/testing`
 * runs them in the same page from a test.
 */
export {checkTitles, checkDescriptions, allChecks} from './checks/catalog.js'
export type {CheckDriver, CheckOptions} from './checks/catalog.js'
export {declaredModes, runChecks} from './checks/runner.js'
