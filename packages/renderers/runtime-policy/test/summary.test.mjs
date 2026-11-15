import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {comparisonModel, extractionModel, rendererSummary} from '@githubnext/projections-renderer-kit'
import {parseSummaryItems} from '@githubnext/projections-renderer-sdk/protocol'
import {summaryCountText} from '@githubnext/projections-renderer-sdk/presentation'
import {createRulesRuntime} from '@githubnext/projections-comparator-runtime'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {runtimePolicyFacts, runtimePolicyNouns} from '../node_modules/.cache/test/summary.js'

const engine = createNativeEngine()
const runtime = createRulesRuntime()
const rules = new Uint8Array(readFileSync(new URL('../../../comparators/runtime-policy/runtime-policy.comparator.yaml', import.meta.url)))
const fixture = name =>
  JSON.parse(readFileSync(new URL(`../../../extractors/tetragon-policies/tests/fixtures/${name}`, import.meta.url), 'utf8'))
const before = fixture('credentials/before.expected.json')
const after = fixture('credentials/after.expected.json')
const library = fixture('library/expected.json')
const base = {
  projection: {id: 'p', title: 'P', renderer: 'runtime-policy'},
  theme: {colorMode: 'light', tokens: {}},
  reducedMotion: false,
  locale: 'en',
}
const words = facts =>
  facts.map(
    fact => `${summaryCountText(fact.count, fact.noun)}${fact.added ? ` +${fact.added}` : ''}${fact.removed ? ` −${fact.removed}` : ''}`,
  )

test('the summary bar says what the security line said: enforcing rules with their change, then the findings', async () => {
  const comparison = await runtime.compare(rules, {protocolVersion: 0, before, after, baseline: {}, options: {}})
  const init = {...base, mode: 'comparison', before, after, comparison, comparisonMode: 'diff'}
  const facts = runtimePolicyFacts({init, model: comparisonModel(before, after, comparison), controls: {}, rendererName: 'runtime-policy'})
  assert.deepEqual(words(facts), ['1 enforcing rule +1', '1 newly enforced', '1 scope broadened', '1 hook no longer covered'])
  assert.deepEqual(
    facts.map(fact => fact.icon),
    [undefined, 'enforced', 'expand', 'exclude'],
  )
  // Each fact filters to what it names, which the comparison has.
  const known = new Set([...comparison.changes.map(change => change.id), ...after.entities.map(item => item.id)])
  for (const fact of facts) for (const id of fact.ids ?? []) assert.ok(known.has(id), `${fact.id}: ${id}`)
  // The policies, hooks and rules in the domain's words, and nothing structural.
  const summary = rendererSummary(init, runtimePolicyNouns, facts)
  assert.ok(parseSummaryItems(summary.items))
  assert.deepEqual(
    summary.items.filter(item => item.type === 'count').map(item => summaryCountText(item.count, item.noun)),
    ['2 policies', '2 hooks', '3 rules'],
  )
})

test('the default comparator finds nothing; enforcing rules are still counted', async () => {
  const comparison = await engine.compare(before, after)
  const init = {...base, mode: 'comparison', before, after, comparison, comparisonMode: 'diff'}
  const facts = runtimePolicyFacts({init, model: comparisonModel(before, after, comparison), controls: {}, rendererName: 'runtime-policy'})
  assert.deepEqual(words(facts), ['1 enforcing rule +1'])
})

test('one revision counts its enforcing rules, without a change', () => {
  const init = {...base, mode: 'extraction', extraction: library}
  const facts = runtimePolicyFacts({init, model: extractionModel(library), controls: {}, rendererName: 'runtime-policy'})
  assert.deepEqual(words(facts), ['0 enforcing rules'])
  assert.equal(facts[0].ids, undefined)
  assert.deepEqual(
    rendererSummary(init, runtimePolicyNouns, facts).items.map(item => (item.type === 'fact' ? item.id : item.kind)),
    ['policy', 'hook', 'selector', 'enforcing'],
  )
})
