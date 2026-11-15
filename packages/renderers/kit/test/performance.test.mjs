import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {comparisonModel, createGraphTransition, layerGap, layoutGraph, scheduleSteps} from '../dist/index.js'
import {layoutRuns} from '../dist/engine/node.js'
import {compare, entity, extraction, relationship, sizedNodes} from './engine.mjs'

/**
 * Layout cost is ELK runs: in a browser every run goes through one worker, and a graph opens only once all of them are
 * done. A layout without a reference orders its cards (one run) and places them (one more); a step of a transition,
 * which takes its union's order, alignment and gap, places them in one; a gap that grows to fit parallel runs costs one
 * run per growth. These budgets keep that from creeping back up.
 */
const renderers = new URL('../../', import.meta.url)
const options = {
  graph: {},
  'graph-horizontal': {orientation: 'horizontal'},
  dag: {},
  architecture: {compound: true},
  infrastructure: {compound: ['module', 'resource-group', 'resource']},
}
/** Most times a layout grows its gap (see the kit's `layerGapAttempts`). */
const growths = 3

const runsOf = async work => {
  const before = layoutRuns()
  const result = await work()
  return {result, runs: layoutRuns() - before}
}

async function scenarios() {
  const directory = new URL('graph/', renderers)
  const {scenarios} = JSON.parse(await readFile(new URL('scenarios.json', directory), 'utf8'))
  const load = async value => (typeof value === 'string' ? JSON.parse(await readFile(new URL(value, directory), 'utf8')) : value)
  const result = []
  for (const scenario of scenarios) {
    const renderer = scenario.renderer ?? 'graph'
    if (renderer === 'dependencies') continue
    result.push({
      scenario,
      options: options[renderer],
      before: scenario.before && (await load(scenario.before)),
      after: scenario.after && (await load(scenario.after)),
      extraction: scenario.extraction && (await load(scenario.extraction)),
    })
  }
  return result
}

/** A layered graph as dense as a large dependency graph: about 70 cards and 120 relationships over six layers. */
function denseGraph(seed) {
  let state = seed
  const random = () => (state = (state * 16807) % 2147483647) / 2147483647
  const layers = [3, 9, 16, 20, 14, 8]
  const ids = layers.map((count, layer) => Array.from({length: count}, (_, index) => `l${layer}n${index}`))
  const relationships = []
  for (let layer = 1; layer < layers.length; layer++)
    for (const id of ids[layer]) {
      const parents = new Set([ids[layer - 1][Math.floor(random() * ids[layer - 1].length)]])
      if (random() < 0.5) parents.add(ids[Math.floor(random() * layer)][0])
      for (const parent of parents) relationships.push(relationship(`${parent}->${id}`, parent, id))
    }
  return extraction(
    'graph/v0',
    ids.flat().map(id => entity(id)),
    relationships,
  )
}

test('a layout without a reference takes two ELK runs, and one more for each time its gap grows', async () => {
  for (const {scenario, options, extraction} of await scenarios()) {
    if (!extraction) continue
    const {result: layout, runs} = await runsOf(async () =>
      layoutGraph(await sizedNodes(extraction.entities), extraction.relationships, options),
    )
    const budget = options.compound ? 1 : 2
    assert.ok(runs <= budget + (layout.layerGap > layerGap ? growths : 0), `${scenario.id}: ${runs} ELK runs`)
  }
})

test('a graph with no relationships, or one with boundaries, is laid out in one ELK run', async () => {
  const loose = extraction(
    'graph/v0',
    ['a', 'b', 'c'].map(id => entity(id)),
  )
  assert.equal((await runsOf(async () => layoutGraph(await sizedNodes(loose.entities), [], {}))).runs, 1)
})

test("a transition's steps take their union's order, alignment and gap: one ELK run each", async () => {
  const subjects = (await scenarios()).filter(subject => subject.before && subject.after)
  const dense = [denseGraph(7), denseGraph(11)]
  subjects.push({scenario: {id: 'dense'}, options: {}, before: dense[0], after: dense[1]})
  for (const {scenario, options, before, after} of subjects) {
    const model = comparisonModel(before, after, await compare(before, after))
    const {result: transition, runs} = await runsOf(() => createGraphTransition(model, scheduleSteps(model), options))
    const union = transition.layouts.find(layout => [...model.entities].every(row => layout.points.has(row.id)))
    const unionRuns = (options.compound ? 1 : 2) + (union && union.layerGap > layerGap ? growths : 0)
    // The union, then Before and After (the layouts between are the union again).
    const budget = unionRuns + 2
    assert.ok(runs <= budget, `${scenario.id}: ${runs} ELK runs for ${transition.layouts.length} layouts (budget ${budget})`)
    // Without boundaries, every step places its cards as the union did.
    if (transition.layouts.every(layout => !layout.groups.size))
      for (const layout of transition.layouts) assert.equal(layout.alignment, transition.layouts[0].alignment, scenario.id)
  }
})
