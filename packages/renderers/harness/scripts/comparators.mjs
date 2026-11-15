// Runs custom comparators (comparator files) the way hosts do: the rules interpreter, in a Worker,
// computes the default baseline and the comparator's comparison, which the Engine
// validates against both extractions before anyone presents it.
import {readFileSync} from 'node:fs'
import {createRulesRuntime} from '@githubnext/projections-comparator-runtime'

let runtime

/**
 * @param {{validateComparison: Function}} engine native Engine
 * @param {string | URL} rules path or file URL of a `.comparator.yaml` file
 */
export async function compareWithRules(engine, before, after, rules, options = {}) {
  runtime ??= createRulesRuntime()
  const bytes = new Uint8Array(readFileSync(rules))
  const output = await runtime.compare(bytes, {protocolVersion: 0, before, after, baseline: {}, options})
  return engine.validateComparison(before, after, output)
}

/** The example comparator file that moves steps changing `options.priority` entities to the front. */
export const priorityOrderRules = new URL('../../../../examples/comparators/priority-order/priority-order.comparator.yaml', import.meta.url)
